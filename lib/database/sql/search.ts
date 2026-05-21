import { createHash } from 'crypto'
import { Knex } from 'knex'

import { getConfig } from '@/lib/config'
import { getConfiguredHost } from '@/lib/config/configuredHost'
import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  deleteMeilisearchDocument,
  deleteMeilisearchDocumentIds,
  deleteMeilisearchDocuments,
  writeMeilisearchDocuments
} from '@/lib/search/meilisearch'
import type {
  MeilisearchDocument,
  MeilisearchType
} from '@/lib/search/meilisearch'
import { parseAccountSearchQuery } from '@/lib/search/parseAccountSearchQuery'
import {
  buildSearchTermPrefixes,
  normalizeSearchTokens
} from '@/lib/search/tokenize'
import {
  ActorDatabase,
  DeleteSearchDocumentParams,
  DeleteSearchDocumentsParams,
  GetSearchHashtagsByIdsParams,
  SearchAccountsParams,
  SearchDatabase,
  SearchEntityType,
  SearchHashtagsParams,
  SearchRebuildParams,
  SearchRebuildResult,
  SearchStatusesParams,
  StatusDatabase,
  UpsertSearchActorParams,
  UpsertSearchHashtagParams,
  UpsertSearchHashtagsParams,
  UpsertSearchStatusParams
} from '@/lib/types/database/operations'
import { SQLActor } from '@/lib/types/database/rows'
import { FollowStatus } from '@/lib/types/domain/follow'
import { Status, StatusType } from '@/lib/types/domain/status'
import * as Mastodon from '@/lib/types/mastodon'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { logger } from '@/lib/utils/logger'

const DEFAULT_LIMIT = 20
const DEFAULT_BATCH_SIZE = 500
const DEFAULT_REBUILD_CONCURRENCY = 8
const MAX_MEILISEARCH_SYNC_QUEUE_SIZE = 1000
const MAX_QUERY_TERMS = 8
const ACCOUNT_FALLBACK_COLUMNS = [
  'actors.username',
  'actors.name',
  'actors.domain'
]
const SQL_WHERE_IN_BATCH_SIZE = 400
const SEARCHABLE_STATUS_TYPES: StatusType[] = [
  StatusType.enum.Note,
  StatusType.enum.Poll
]
const PUBLIC_ACTIVITY_RECIPIENTS = [
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
]

type SearchDocumentInput = {
  entityType: SearchEntityType
  entityId: string
  actorId?: string | null
  trx?: Knex.Transaction
  visibility?: string | null
  searchText: string
  entityCreatedAt?: number | Date | string | null
  syncMeilisearch?: boolean
  weightedText?: {
    text: string
    weight: number
  }[]
}

type SQLStatusSearchRow = {
  id: string
  actorId: string
  type: string
  content: string | Record<string, unknown> | null
  createdAt: Date | string | number
  updatedAt: Date | string | number
}

type SQLTagSearchRow = {
  name: string
  statusId?: string
  value: string | null
  nameNormalized: string | null
  createdAt: Date | string | number
}

type KeysetRow = {
  id: string
  createdAt: Date | string | number
}

type SearchCursorRow = {
  entityId: string
  entityIdHash: string
  entityCreatedAt: Date | string | number | null
  searchScore: string | number
}

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

const normalizeLimit = (limit?: number) => Math.max(1, limit ?? DEFAULT_LIMIT)
const normalizeOffset = (offset?: number) => Math.max(0, offset ?? 0)
const normalizeBatchSize = (batchSize?: number) =>
  Math.max(1, batchSize ?? DEFAULT_BATCH_SIZE)

export const getSearchDocumentId = (
  entityType: SearchEntityType,
  entityId: string
) =>
  createHash('sha256')
    .update(`${entityType}\0${entityId}`, 'utf8')
    .digest('hex')
const getSearchEntityIdHash = (entityId: string) =>
  createHash('sha256').update(entityId, 'utf8').digest('hex')

const getHashtagDisplayName = (name: string) =>
  name.startsWith('#') ? name.slice(1) : name

const getHashtagId = (name: string) => {
  const bareName = getHashtagDisplayName(name)
  return bareName.trim().toLowerCase()
}

const getNormalizedStoredHashtagName = (hashtagId: string) => `#${hashtagId}`

const toMeilisearchType = (entityType: SearchEntityType): MeilisearchType => {
  switch (entityType) {
    case 'account':
      return 'accounts'
    case 'status':
      return 'statuses'
    case 'hashtag':
      return 'hashtags'
  }
}

const parseStatusContent = (
  content: string | Record<string, unknown> | null
): Record<string, unknown> => {
  if (!content) return {}
  if (typeof content === 'string') {
    try {
      const parsed = getCompatibleJSON(content)
      return typeof parsed === 'object' && parsed !== null ? parsed : {}
    } catch {
      return { text: content }
    }
  }
  return content
}

const getString = (value: unknown) => (typeof value === 'string' ? value : '')

const addWeightedTerms = (
  termWeights: Map<string, number>,
  text: string,
  weight: number
) => {
  if (!text) return

  const tokens = normalizeSearchTokens(text)
  for (const term of buildSearchTermPrefixes(tokens)) {
    termWeights.set(term, Math.max(termWeights.get(term) ?? 0, weight))
  }
}

const getWeightedTerms = ({
  searchText,
  weightedText = [{ text: searchText, weight: 1 }]
}: Pick<SearchDocumentInput, 'searchText' | 'weightedText'>) => {
  const termWeights = new Map<string, number>()
  for (const item of weightedText) {
    addWeightedTerms(termWeights, item.text, item.weight)
  }
  return [...termWeights.entries()].map(([term, weight]) => ({
    term,
    weight
  }))
}

const getMeilisearchWriteConfig = () => {
  const config = getConfig().search
  return config?.backend === 'meilisearch' ? config : null
}

const toMeilisearchDocument = ({
  id,
  entityType,
  entityId,
  actorId,
  visibility,
  searchText,
  entityCreatedAt
}: {
  id: string
  entityType: SearchEntityType
  entityId: string
  actorId: string | null
  visibility: string | null
  searchText: string
  entityCreatedAt: number | Date | string | null
}): MeilisearchDocument => ({
  id,
  entityId,
  text: searchText,
  entityType: toMeilisearchType(entityType),
  actorId,
  visibility,
  entityCreatedAt: entityCreatedAt ? getCompatibleTime(entityCreatedAt) : null
})

const warnMeilisearchWriteFailure = ({
  action,
  entityType,
  entityId,
  error
}: {
  action: string
  entityType?: SearchEntityType
  entityId?: string
  error: unknown
}) => {
  logger.warn({
    message:
      'Meilisearch search index write failed; SQL search index remains canonical',
    action,
    ...(entityType ? { entityType } : null),
    ...(entityId ? { entityId } : null),
    error: error instanceof Error ? error.message : String(error)
  })
}

const applyKeysetCursor = (
  query: Knex.QueryBuilder,
  cursor: KeysetRow | null,
  createdAtColumn = 'createdAt',
  idColumn = 'id'
): Knex.QueryBuilder => {
  if (!cursor) return query

  const cursorCreatedAt = getCompatibleTime(cursor.createdAt)
  return query.where((builder) => {
    builder
      .where(createdAtColumn, '>', cursorCreatedAt)
      .orWhere((sameCreatedAt) => {
        sameCreatedAt
          .where(createdAtColumn, '=', cursorCreatedAt)
          .where(idColumn, '>', cursor.id)
      })
  })
}

const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
) => {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workerCount = Math.min(concurrency, items.length)

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        const index = nextIndex
        nextIndex += 1
        if (index >= items.length) return

        results[index] = await worker(items[index])
      }
    })
  )

  return results
}

export const SearchSQLDatabaseMixin = (
  database: Knex,
  actorDatabase: ActorDatabase,
  statusDatabase: StatusDatabase
): SearchDatabase => {
  let meilisearchSyncQueue: Promise<void> = Promise.resolve()
  let queuedMeilisearchSyncTasks = 0

  function enqueueMeilisearchSync(task: () => Promise<void>) {
    if (queuedMeilisearchSyncTasks >= MAX_MEILISEARCH_SYNC_QUEUE_SIZE) {
      logger.warn({
        message: 'Dropping Meilisearch search index synchronization task',
        queueSize: queuedMeilisearchSyncTasks
      })
      return
    }

    queuedMeilisearchSyncTasks += 1
    meilisearchSyncQueue = meilisearchSyncQueue
      .then(
        () => task(),
        () => task()
      )
      .catch((error) => {
        logger.warn({
          message:
            'Unexpected Meilisearch search index synchronization queue failure',
          error: error instanceof Error ? error.message : String(error)
        })
      })
      .finally(() => {
        queuedMeilisearchSyncTasks -= 1
      })
  }

  async function syncMeilisearchDocument({
    documentRow
  }: {
    documentRow: {
      id: string
      entityType: SearchEntityType
      entityId: string
      actorId: string | null
      visibility: string | null
      searchText: string
      entityCreatedAt: number | Date | string | null
    }
  }) {
    try {
      const config = getMeilisearchWriteConfig()
      if (!config) return

      await writeMeilisearchDocuments({
        config,
        type: toMeilisearchType(documentRow.entityType),
        documents: [toMeilisearchDocument(documentRow)]
      })
    } catch (error) {
      warnMeilisearchWriteFailure({
        action: 'upsert',
        entityType: documentRow.entityType,
        entityId: documentRow.entityId,
        error
      })
    }
  }

  async function syncMeilisearchDelete({
    entityType,
    entityId,
    documentId
  }: DeleteSearchDocumentParams & { documentId: string }) {
    try {
      const config = getMeilisearchWriteConfig()
      if (!config) return

      await deleteMeilisearchDocument({
        config,
        type: toMeilisearchType(entityType),
        documentId
      })
    } catch (error) {
      warnMeilisearchWriteFailure({
        action: 'delete',
        entityType,
        entityId,
        error
      })
    }
  }

  async function syncMeilisearchDeleteMany(
    documents: Pick<DeleteSearchDocumentParams, 'entityType' | 'entityId'>[]
  ) {
    try {
      const config = getMeilisearchWriteConfig()
      if (!config || documents.length === 0) return

      const documentIdsByType = documents.reduce((typeMap, document) => {
        const documentsForType = typeMap.get(document.entityType) ?? []
        documentsForType.push(
          getSearchDocumentId(document.entityType, document.entityId)
        )
        typeMap.set(document.entityType, documentsForType)
        return typeMap
      }, new Map<SearchEntityType, string[]>())

      for (const [entityType, documentIds] of documentIdsByType) {
        for (const documentIdChunk of chunkArray(
          documentIds,
          SQL_WHERE_IN_BATCH_SIZE
        )) {
          await deleteMeilisearchDocumentIds({
            config,
            type: toMeilisearchType(entityType),
            documentIds: documentIdChunk
          })
        }
      }
    } catch (error) {
      warnMeilisearchWriteFailure({
        action: 'delete',
        error
      })
    }
  }

  async function syncMeilisearchClear() {
    try {
      const config = getMeilisearchWriteConfig()
      if (!config) return

      await Promise.all(
        (['account', 'status', 'hashtag'] as SearchEntityType[]).map(
          async (entityType) => {
            await deleteMeilisearchDocuments({
              config,
              type: toMeilisearchType(entityType)
            })
          }
        )
      )
    } catch (error) {
      warnMeilisearchWriteFailure({
        action: 'clear',
        error
      })
    }
  }

  async function deleteSearchDocument({
    entityType,
    entityId,
    deleteSql = true,
    syncMeilisearch = true,
    trx
  }: DeleteSearchDocumentParams & { trx?: Knex.Transaction }): Promise<void> {
    const documentId = getSearchDocumentId(entityType, entityId)
    if (deleteSql) {
      const deleteSqlDocument = async (query: Knex.Transaction) => {
        // Keep child deletes explicit for SQLite connections without PRAGMA foreign_keys.
        await query('search_terms').where('documentId', documentId).delete()
        await query('search_documents').where('id', documentId).delete()
      }

      if (trx) {
        await deleteSqlDocument(trx)
      } else {
        await database.transaction(deleteSqlDocument)
      }
    }
    if (syncMeilisearch) {
      enqueueMeilisearchSync(() =>
        syncMeilisearchDelete({ entityType, entityId, documentId })
      )
    }
  }

  async function deleteSearchDocuments({
    documents,
    deleteSql = true,
    syncMeilisearch = true
  }: DeleteSearchDocumentsParams): Promise<void> {
    if (documents.length === 0) return

    if (deleteSql) {
      const documentIds = documents.map((document) =>
        getSearchDocumentId(document.entityType, document.entityId)
      )
      await database.transaction(async (trx) => {
        for (const documentIdChunk of chunkArray(
          documentIds,
          SQL_WHERE_IN_BATCH_SIZE
        )) {
          // Keep child deletes explicit for SQLite connections without PRAGMA foreign_keys.
          await trx('search_terms')
            .whereIn('documentId', documentIdChunk)
            .delete()
          await trx('search_documents').whereIn('id', documentIdChunk).delete()
        }
      })
    }

    if (syncMeilisearch) {
      enqueueMeilisearchSync(() => syncMeilisearchDeleteMany(documents))
    }
  }

  async function replaceSearchDocument({
    entityType,
    entityId,
    actorId = null,
    trx,
    visibility = null,
    searchText,
    entityCreatedAt = null,
    syncMeilisearch = true,
    weightedText
  }: SearchDocumentInput): Promise<void> {
    const weightedTerms = getWeightedTerms({ searchText, weightedText })
    if (weightedTerms.length === 0) {
      await deleteSearchDocument({ entityType, entityId, syncMeilisearch, trx })
      return
    }

    const documentId = getSearchDocumentId(entityType, entityId)
    const currentTime = new Date()
    const documentRow = {
      id: documentId,
      entityType,
      entityId,
      entityIdHash: getSearchEntityIdHash(entityId),
      actorId,
      visibility,
      searchText,
      searchable: true,
      entityCreatedAt: entityCreatedAt ? new Date(entityCreatedAt) : null,
      updatedAt: currentTime
    }

    const replaceSqlDocument = async (query: Knex.Transaction) => {
      await query('search_documents')
        .insert({
          ...documentRow,
          createdAt: currentTime
        })
        .onConflict('id')
        .merge(documentRow)

      // Replacement upserts the parent row, so cascades do not clear prior terms.
      // Keep child deletes explicit for SQLite connections without PRAGMA foreign_keys.
      await query('search_terms').where('documentId', documentId).delete()
      await query('search_terms').insert(
        weightedTerms.map(({ term, weight }) => ({
          documentId,
          entityType,
          term,
          weight,
          createdAt: currentTime
        }))
      )
    }

    if (trx) {
      await replaceSqlDocument(trx)
    } else {
      await database.transaction(replaceSqlDocument)
    }
    if (syncMeilisearch) {
      enqueueMeilisearchSync(() => syncMeilisearchDocument({ documentRow }))
    }
  }

  async function getStatusVisibility(
    statusId: string
  ): Promise<'public' | 'unlisted' | null> {
    const recipients = await database('recipients')
      .where('statusId', statusId)
      .select<{ actorId: string; type: string }[]>('actorId', 'type')

    const publicTo = recipients.some(
      (recipient) =>
        recipient.type === 'to' &&
        PUBLIC_ACTIVITY_RECIPIENTS.includes(recipient.actorId)
    )
    if (publicTo) return 'public'

    const publicCc = recipients.some(
      (recipient) =>
        recipient.type === 'cc' &&
        PUBLIC_ACTIVITY_RECIPIENTS.includes(recipient.actorId)
    )
    return publicCc ? 'unlisted' : null
  }

  async function replaceActorSearchDocument({
    actor,
    syncMeilisearch,
    trx
  }: {
    actor: SQLActor
    syncMeilisearch: boolean
    trx?: Knex.Transaction
  }): Promise<boolean> {
    const acct = `${actor.username}@${actor.domain}`
    const searchText = [
      actor.username,
      actor.domain,
      acct,
      actor.name,
      actor.summary
    ]
      .filter((item): item is string => Boolean(item))
      .join(' ')

    await replaceSearchDocument({
      entityType: 'account',
      entityId: actor.id,
      actorId: actor.id,
      trx,
      searchText,
      entityCreatedAt: actor.createdAt,
      syncMeilisearch,
      weightedText: [
        { text: actor.username, weight: 8 },
        { text: acct, weight: 8 },
        { text: actor.name ?? '', weight: 5 },
        { text: actor.domain, weight: 2 },
        { text: actor.summary ?? '', weight: 1 }
      ]
    })
    return true
  }

  async function upsertActorSearchDocument({
    actorId,
    syncMeilisearch = true
  }: UpsertSearchActorParams): Promise<boolean> {
    const actor = await database<SQLActor>('actors')
      .where('id', actorId)
      .first()

    if (!actor || actor.deletionStatus) {
      await deleteSearchDocument({
        entityType: 'account',
        entityId: actorId,
        syncMeilisearch
      })
      return false
    }

    return replaceActorSearchDocument({ actor, syncMeilisearch })
  }

  async function rebuildActorSearchDocuments({
    actors,
    syncMeilisearch,
    concurrency
  }: {
    actors: KeysetRow[]
    syncMeilisearch: boolean
    concurrency: number
  }): Promise<boolean[]> {
    const actorIds = actors.map((actor) => actor.id)
    if (actorIds.length === 0) return []

    const actorRows = await database<SQLActor>('actors')
      .whereIn('id', actorIds)
      .whereNull('deletionStatus')
      .select<SQLActor[]>('*')
    const actorById = new Map(actorRows.map((actor) => [actor.id, actor]))

    const rebuildDocuments = async (trx?: Knex.Transaction) =>
      mapWithConcurrency(actors, concurrency, async ({ id }) => {
        const actor = actorById.get(id)
        if (!actor) {
          await deleteSearchDocument({
            entityType: 'account',
            entityId: id,
            syncMeilisearch,
            trx
          })
          return false
        }

        return replaceActorSearchDocument({ actor, syncMeilisearch, trx })
      })

    if (!syncMeilisearch) {
      return database.transaction((trx) => rebuildDocuments(trx))
    }

    return rebuildDocuments()
  }

  async function upsertStatusSearchDocument({
    statusId,
    syncMeilisearch = true
  }: UpsertSearchStatusParams): Promise<boolean> {
    const status = await database<SQLStatusSearchRow>('statuses')
      .innerJoin('actors', 'statuses.actorId', 'actors.id')
      .where('statuses.id', statusId)
      .whereNull('actors.deletionStatus')
      .select<SQLStatusSearchRow[]>('statuses.*')
      .first()

    if (
      !status ||
      !SEARCHABLE_STATUS_TYPES.includes(status.type as StatusType)
    ) {
      await deleteSearchDocument({
        entityType: 'status',
        entityId: statusId,
        syncMeilisearch
      })
      return false
    }

    const visibility = await getStatusVisibility(status.id)
    if (!visibility) {
      await deleteSearchDocument({
        entityType: 'status',
        entityId: status.id,
        syncMeilisearch
      })
      return false
    }

    const content = parseStatusContent(status.content)
    const tags = await database('tags')
      .where('statusId', status.id)
      .where('type', 'hashtag')
      .select<{ name: string }[]>('name')
    const tagText = tags.map((tag) => tag.name).join(' ')
    const text = getString(content.text)
    const summary = getString(content.summary)
    const searchText = [text, summary, tagText].filter(Boolean).join(' ')

    await replaceSearchDocument({
      entityType: 'status',
      entityId: status.id,
      actorId: status.actorId,
      visibility,
      searchText,
      entityCreatedAt: status.createdAt,
      syncMeilisearch,
      weightedText: [
        { text, weight: 5 },
        { text: tagText, weight: 4 },
        { text: summary, weight: 2 }
      ]
    })
    return true
  }

  async function rebuildStatusSearchDocuments({
    statuses,
    syncMeilisearch,
    concurrency
  }: {
    statuses: KeysetRow[]
    syncMeilisearch: boolean
    concurrency: number
  }): Promise<boolean[]> {
    const statusIds = statuses.map((status) => status.id)
    if (statusIds.length === 0) return []

    const [statusRows, recipientRows, tagRows] = await Promise.all([
      database<SQLStatusSearchRow>('statuses')
        .innerJoin('actors', 'statuses.actorId', 'actors.id')
        .whereIn('statuses.id', statusIds)
        .whereNull('actors.deletionStatus')
        .select<SQLStatusSearchRow[]>('statuses.*'),
      database('recipients')
        .whereIn('statusId', statusIds)
        .whereIn('actorId', PUBLIC_ACTIVITY_RECIPIENTS)
        .whereIn('type', ['to', 'cc'])
        .select<{ statusId: string; type: string }[]>('statusId', 'type'),
      database('tags')
        .whereIn('statusId', statusIds)
        .where('type', 'hashtag')
        .select<
          Pick<SQLTagSearchRow, 'statusId' | 'name'>[]
        >('statusId', 'name')
    ])
    const statusById = new Map(statusRows.map((status) => [status.id, status]))
    const visibilityByStatusId = recipientRows.reduce((visibilityMap, row) => {
      const currentVisibility = visibilityMap.get(row.statusId)
      if (row.type === 'to') {
        visibilityMap.set(row.statusId, 'public')
      } else if (!currentVisibility) {
        visibilityMap.set(row.statusId, 'unlisted')
      }
      return visibilityMap
    }, new Map<string, 'public' | 'unlisted'>())
    const tagTextByStatusId = tagRows.reduce((tagMap, row) => {
      if (!row.statusId) return tagMap

      tagMap.set(row.statusId, [...(tagMap.get(row.statusId) ?? []), row.name])
      return tagMap
    }, new Map<string, string[]>())

    const rebuildDocuments = async (trx?: Knex.Transaction) =>
      mapWithConcurrency(statuses, concurrency, async ({ id }) => {
        const status = statusById.get(id)
        if (
          !status ||
          !SEARCHABLE_STATUS_TYPES.includes(status.type as StatusType)
        ) {
          await deleteSearchDocument({
            entityType: 'status',
            entityId: id,
            syncMeilisearch,
            trx
          })
          return false
        }

        const visibility = visibilityByStatusId.get(id)
        if (!visibility) {
          await deleteSearchDocument({
            entityType: 'status',
            entityId: id,
            syncMeilisearch,
            trx
          })
          return false
        }

        const content = parseStatusContent(status.content)
        const tagText = (tagTextByStatusId.get(id) ?? []).join(' ')
        const text = getString(content.text)
        const summary = getString(content.summary)
        const searchText = [text, summary, tagText].filter(Boolean).join(' ')

        await replaceSearchDocument({
          entityType: 'status',
          entityId: status.id,
          actorId: status.actorId,
          visibility,
          searchText,
          entityCreatedAt: status.createdAt,
          syncMeilisearch,
          trx,
          weightedText: [
            { text, weight: 5 },
            { text: tagText, weight: 4 },
            { text: summary, weight: 2 }
          ]
        })
        return true
      })

    if (!syncMeilisearch) {
      return database.transaction((trx) => rebuildDocuments(trx))
    }

    return rebuildDocuments()
  }

  async function getPublicHashtagRows(
    hashtagIds: string[]
  ): Promise<SQLTagSearchRow[]> {
    const uniqueHashtagIds = [...new Set(hashtagIds)].filter(Boolean)
    if (uniqueHashtagIds.length === 0) return []

    const rowGroups = await Promise.all(
      chunkArray(uniqueHashtagIds, SQL_WHERE_IN_BATCH_SIZE).map(
        async (hashtagIdChunk) => {
          const normalizedNames = hashtagIdChunk.map(
            getNormalizedStoredHashtagName
          )
          const rows = await database('tags')
            .innerJoin('statuses', 'tags.statusId', 'statuses.id')
            .innerJoin('actors', 'statuses.actorId', 'actors.id')
            .where('tags.type', 'hashtag')
            .whereIn('tags.nameNormalized', [
              ...normalizedNames,
              ...hashtagIdChunk
            ])
            .whereIn('statuses.type', SEARCHABLE_STATUS_TYPES)
            .whereExists(function () {
              this.select(database.raw('1'))
                .from('recipients')
                .whereRaw('?? = ??', ['recipients.statusId', 'statuses.id'])
                .whereIn('recipients.actorId', PUBLIC_ACTIVITY_RECIPIENTS)
                .whereIn('recipients.type', ['to', 'cc'])
            })
            .whereNull('actors.deletionStatus')
            .groupBy('tags.nameNormalized', 'tags.name', 'tags.value')
            .select<SQLTagSearchRow[]>(
              'tags.name',
              'tags.value',
              'tags.nameNormalized'
            )
            .min({ createdAt: 'tags.createdAt' })
            .orderBy('createdAt', 'asc')
          return rows as SQLTagSearchRow[]
        }
      )
    )
    return rowGroups.flat()
  }

  async function upsertHashtagSearchDocuments({
    names,
    syncMeilisearch = true
  }: UpsertSearchHashtagsParams): Promise<boolean[]> {
    const hashtagIds = [...new Set(names.map(getHashtagId).filter(Boolean))]
    if (hashtagIds.length === 0) return []

    const rows = await getPublicHashtagRows(hashtagIds)
    const rowByHashtagId = rows.reduce((tagMap, row) => {
      const hashtagId = getHashtagId(row.name)
      if (!tagMap.has(hashtagId)) {
        tagMap.set(hashtagId, row)
      }
      return tagMap
    }, new Map<string, SQLTagSearchRow>())

    return mapWithConcurrency(
      hashtagIds,
      DEFAULT_REBUILD_CONCURRENCY,
      async (hashtagId) => {
        const tag = rowByHashtagId.get(hashtagId)
        if (!tag) {
          await deleteSearchDocument({
            entityType: 'hashtag',
            entityId: hashtagId,
            syncMeilisearch
          })
          return false
        }

        const displayName = getHashtagDisplayName(tag.name)
        await replaceSearchDocument({
          entityType: 'hashtag',
          entityId: hashtagId,
          searchText: [displayName, hashtagId].join(' '),
          entityCreatedAt: tag.createdAt,
          syncMeilisearch,
          weightedText: [
            { text: displayName, weight: 8 },
            { text: hashtagId, weight: 8 }
          ]
        })
        return true
      }
    )
  }

  async function upsertHashtagSearchDocument({
    name,
    syncMeilisearch = true
  }: UpsertSearchHashtagParams): Promise<boolean> {
    const [indexed] = await upsertHashtagSearchDocuments({
      names: [name],
      syncMeilisearch
    })
    return indexed ?? false
  }

  async function clearSearchIndex(syncMeilisearch = true): Promise<void> {
    await database.transaction(async (trx) => {
      // Keep child deletes explicit for SQLite connections without PRAGMA foreign_keys.
      await trx('search_terms').delete()
      await trx('search_documents').delete()
    })
    if (syncMeilisearch) {
      enqueueMeilisearchSync(syncMeilisearchClear)
    }
  }

  async function getSearchQueryTerms(query: string) {
    return normalizeSearchTokens(query)
      .filter((term) => term.length >= 2)
      .slice(0, MAX_QUERY_TERMS)
  }

  const buildTermMatchesQuery = ({
    entityType,
    queryTerms
  }: {
    entityType: SearchEntityType
    queryTerms: string[]
  }) =>
    database('search_terms')
      .select('documentId')
      .sum({ searchScore: 'weight' })
      .where('entityType', entityType)
      .whereIn('term', queryTerms)
      .groupBy('documentId')
      .havingRaw('COUNT(*) = ?', [queryTerms.length])

  const applyBlockFilter = (
    documentsQuery: Knex.QueryBuilder,
    currentActorId?: string
  ) => {
    if (!currentActorId) return documentsQuery

    return documentsQuery
      .whereNotExists(function () {
        this.select(database.raw('1'))
          .from('blocks')
          .where('blocks.actorId', currentActorId)
          .whereRaw('?? = ??', [
            'blocks.targetActorId',
            'search_documents.actorId'
          ])
      })
      .whereNotExists(function () {
        this.select(database.raw('1'))
          .from('blocks')
          .whereRaw('?? = ??', ['blocks.actorId', 'search_documents.actorId'])
          .where('blocks.targetActorId', currentActorId)
      })
  }

  const buildMatchedDocumentsQuery = ({
    entityType,
    queryTerms,
    currentActorId,
    following,
    accountId,
    excludedEntityIds = []
  }: {
    entityType: SearchEntityType
    queryTerms: string[]
    currentActorId?: string
    following?: boolean
    accountId?: string
    excludedEntityIds?: string[]
  }) => {
    let documentsQuery = database('search_documents')
      .innerJoin(
        buildTermMatchesQuery({ entityType, queryTerms }).as('term_matches'),
        'search_documents.id',
        'term_matches.documentId'
      )
      .where('search_documents.entityType', entityType)
      .where('search_documents.searchable', true)

    if (excludedEntityIds.length > 0) {
      documentsQuery = documentsQuery.whereNotIn(
        'search_documents.entityId',
        excludedEntityIds
      )
    }

    documentsQuery = applyBlockFilter(documentsQuery, currentActorId)

    if (entityType === 'account' && following) {
      if (!currentActorId) return null
      documentsQuery = documentsQuery
        .innerJoin(
          'follows',
          'follows.targetActorId',
          'search_documents.actorId'
        )
        .where('follows.actorId', currentActorId)
        .where('follows.status', FollowStatus.enum.Accepted)
    }

    if (entityType === 'status' && accountId) {
      documentsQuery = documentsQuery.where(
        'search_documents.actorId',
        accountId
      )
    }

    return documentsQuery
  }

  async function getMatchedDocumentCount({
    entityType,
    query,
    currentActorId,
    following,
    accountId,
    excludedEntityIds = []
  }: {
    entityType: SearchEntityType
    query: string
    currentActorId?: string
    following?: boolean
    accountId?: string
    excludedEntityIds?: string[]
  }): Promise<number> {
    const queryTerms = await getSearchQueryTerms(query)
    if (queryTerms.length === 0) return 0

    const documentsQuery = buildMatchedDocumentsQuery({
      entityType,
      queryTerms,
      currentActorId,
      following,
      accountId,
      excludedEntityIds
    })
    if (!documentsQuery) return 0

    const row = await documentsQuery
      .count<{ count: string | number }>({ count: '*' })
      .first()
    return Number(row?.count ?? 0)
  }

  async function getMatchedDocumentIds({
    entityType,
    query,
    limit,
    offset,
    currentActorId,
    following,
    accountId,
    minStatusId,
    maxStatusId,
    excludedEntityIds = []
  }: {
    entityType: SearchEntityType
    query: string
    limit: number
    offset: number
    currentActorId?: string
    following?: boolean
    accountId?: string
    minStatusId?: string
    maxStatusId?: string
    excludedEntityIds?: string[]
  }): Promise<string[]> {
    const queryTerms = await getSearchQueryTerms(query)
    if (queryTerms.length === 0) return []

    const getStatusSearchCursor = async (statusId: string) =>
      database('search_documents')
        .innerJoin(
          buildTermMatchesQuery({ entityType: 'status', queryTerms }).as(
            'term_matches'
          ),
          'search_documents.id',
          'term_matches.documentId'
        )
        .where('search_documents.entityType', 'status')
        .where('search_documents.searchable', true)
        .where('search_documents.id', getSearchDocumentId('status', statusId))
        .select<SearchCursorRow[]>(
          'search_documents.entityId',
          'search_documents.entityIdHash',
          'search_documents.entityCreatedAt',
          'term_matches.searchScore'
        )
        .first()

    const baseDocumentsQuery = buildMatchedDocumentsQuery({
      entityType,
      queryTerms,
      currentActorId,
      following,
      accountId,
      excludedEntityIds
    })
    if (!baseDocumentsQuery) return []
    let documentsQuery = baseDocumentsQuery

    const applyStatusSearchCursor = (
      direction: 'before' | 'after',
      cursor: SearchCursorRow
    ) => {
      const cursorOperator = direction === 'before' ? '>' : '<'
      const entityCreatedAt = cursor.entityCreatedAt
        ? getCompatibleTime(cursor.entityCreatedAt)
        : null

      documentsQuery = documentsQuery.where((builder) => {
        builder
          .where('term_matches.searchScore', cursorOperator, cursor.searchScore)
          .orWhere((sameScore) => {
            sameScore
              .where('term_matches.searchScore', '=', cursor.searchScore)
              .where((sameScoreTie) => {
                sameScoreTie.where((sameCreatedAt) => {
                  if (entityCreatedAt === null) {
                    sameCreatedAt.where((sameNullCreatedAt) => {
                      sameNullCreatedAt
                        .whereNull('search_documents.entityCreatedAt')
                        .where(
                          'search_documents.entityIdHash',
                          cursorOperator,
                          cursor.entityIdHash
                        )
                    })
                    if (direction === 'before') {
                      sameCreatedAt.orWhereNotNull(
                        'search_documents.entityCreatedAt'
                      )
                    }
                    return
                  }

                  if (direction === 'after') {
                    sameCreatedAt
                      .whereNull('search_documents.entityCreatedAt')
                      .orWhere(
                        'search_documents.entityCreatedAt',
                        cursorOperator,
                        entityCreatedAt
                      )
                      .orWhere((sameNonNullCreatedAt) => {
                        sameNonNullCreatedAt
                          .where(
                            'search_documents.entityCreatedAt',
                            '=',
                            entityCreatedAt
                          )
                          .where(
                            'search_documents.entityIdHash',
                            cursorOperator,
                            cursor.entityIdHash
                          )
                      })
                    return
                  }

                  sameCreatedAt
                    .whereNotNull('search_documents.entityCreatedAt')
                    .where((sameNonNullCreatedAt) => {
                      sameNonNullCreatedAt
                        .where(
                          'search_documents.entityCreatedAt',
                          cursorOperator,
                          entityCreatedAt
                        )
                        .orWhere((sameTimestamp) => {
                          sameTimestamp
                            .where(
                              'search_documents.entityCreatedAt',
                              '=',
                              entityCreatedAt
                            )
                            .where(
                              'search_documents.entityIdHash',
                              cursorOperator,
                              cursor.entityIdHash
                            )
                        })
                    })
                })
              })
          })
      })
    }

    const isPagingUp =
      entityType === 'status' && Boolean(minStatusId && !maxStatusId)

    if (entityType === 'status' && minStatusId) {
      const cursor = await getStatusSearchCursor(minStatusId)
      if (cursor) {
        applyStatusSearchCursor('before', cursor)
      }
    }

    if (entityType === 'status' && maxStatusId) {
      const cursor = await getStatusSearchCursor(maxStatusId)
      if (cursor) {
        applyStatusSearchCursor('after', cursor)
      }
    }

    const orderDirection = isPagingUp ? 'asc' : 'desc'
    const nullOrderDirection = isPagingUp ? 'desc' : 'asc'
    const rows = await documentsQuery
      .select<{ entityId: string }[]>('search_documents.entityId')
      .orderBy('term_matches.searchScore', orderDirection)
      .orderByRaw(`?? IS NULL ${nullOrderDirection}`, [
        'search_documents.entityCreatedAt'
      ])
      .orderBy('search_documents.entityCreatedAt', orderDirection)
      .orderBy('search_documents.entityIdHash', orderDirection)
      .limit(limit)
      .offset(offset)

    const entityIds = rows.map((row) => row.entityId)
    return isPagingUp ? entityIds.reverse() : entityIds
  }

  const getExactAccountActorId = async (
    query: string
  ): Promise<string | null> => {
    const parsed = parseAccountSearchQuery(query)
    if (!parsed) return null

    const actor = await actorDatabase.getActorFromUsername({
      username: parsed.username,
      domain: parsed.domain
    })
    return actor?.id ?? null
  }

  const filterFollowingActorIds = async (
    actorIds: string[],
    currentActorId?: string
  ) => {
    if (!currentActorId || actorIds.length === 0) return []

    const rows = await database('follows')
      .where('actorId', currentActorId)
      .where('status', FollowStatus.enum.Accepted)
      .whereIn('targetActorId', actorIds)
      .select<{ targetActorId: string }[]>('targetActorId')
    const followedActorIds = new Set(rows.map((row) => row.targetActorId))
    return actorIds.filter((actorId) => followedActorIds.has(actorId))
  }

  const filterUnblockedActorIds = async (
    actorIds: string[],
    currentActorId?: string
  ) => {
    if (!currentActorId || actorIds.length === 0) return actorIds

    const rows = await database('blocks')
      .where((builder) => {
        builder
          .where('actorId', currentActorId)
          .whereIn('targetActorId', actorIds)
      })
      .orWhere((builder) => {
        builder
          .whereIn('actorId', actorIds)
          .where('targetActorId', currentActorId)
      })
      .select<{ actorId: string; targetActorId: string }[]>(
        'actorId',
        'targetActorId'
      )
    const blockedActorIds = new Set(
      rows.map((row) =>
        row.actorId === currentActorId ? row.targetActorId : row.actorId
      )
    )
    return actorIds.filter((actorId) => !blockedActorIds.has(actorId))
  }

  async function getFallbackAccountActorIds({
    query,
    limit,
    offset,
    currentActorId,
    following = false,
    excludedActorIds = []
  }: {
    query: string
    limit: number
    offset: number
    currentActorId?: string
    following?: boolean
    excludedActorIds?: string[]
  }): Promise<string[]> {
    if (limit <= 0) return []
    if (following && !currentActorId) return []

    const queryTerms = await getSearchQueryTerms(query)
    if (queryTerms.length === 0) return []
    const indexedDocumentsQuery = buildMatchedDocumentsQuery({
      entityType: 'account',
      queryTerms,
      currentActorId,
      following,
      excludedEntityIds: excludedActorIds
    })

    let fallbackQuery = database<SQLActor>('actors')
      .whereNull('actors.deletionStatus')
      .modify((builder) => {
        if (excludedActorIds.length > 0) {
          builder.whereNotIn('actors.id', excludedActorIds)
        }
      })

    if (indexedDocumentsQuery) {
      fallbackQuery = fallbackQuery.whereNotIn(
        'actors.id',
        indexedDocumentsQuery.select('search_documents.entityId')
      )
    }

    if (currentActorId) {
      fallbackQuery = fallbackQuery
        .whereNotExists(function () {
          this.select(database.raw('1'))
            .from('blocks')
            .where('blocks.actorId', currentActorId)
            .whereRaw('?? = ??', ['blocks.targetActorId', 'actors.id'])
        })
        .whereNotExists(function () {
          this.select(database.raw('1'))
            .from('blocks')
            .whereRaw('?? = ??', ['blocks.actorId', 'actors.id'])
            .where('blocks.targetActorId', currentActorId)
        })
    }

    if (following) {
      fallbackQuery = fallbackQuery
        .innerJoin('follows', 'follows.targetActorId', 'actors.id')
        .where('follows.actorId', currentActorId)
        .where('follows.status', FollowStatus.enum.Accepted)
    }

    for (const term of queryTerms) {
      fallbackQuery = fallbackQuery.where((termBuilder) => {
        for (const column of ACCOUNT_FALLBACK_COLUMNS) {
          termBuilder.orWhereRaw('LOWER(??) LIKE ?', [column, `%${term}%`])
        }
      })
    }

    const rows = await fallbackQuery
      .select<{ id: string }[]>('actors.id')
      .orderBy('actors.username', 'asc')
      .orderBy('actors.domain', 'asc')
      .limit(limit)
      .offset(offset)
    return rows.map((row) => row.id)
  }

  const hydrateAccounts = (actorIds: string[]) =>
    actorDatabase.getMastodonActorsFromIds({ ids: actorIds })

  async function searchAccounts({
    query,
    limit,
    offset,
    currentActorId,
    following = false
  }: SearchAccountsParams): Promise<Mastodon.Account[]> {
    const normalizedLimit = normalizeLimit(limit)
    const normalizedOffset = normalizeOffset(offset)
    const shouldTryExactAccount = Boolean(query.trim())
    const exactActorId = shouldTryExactAccount
      ? await getExactAccountActorId(query)
      : null
    const exactActorIds = await filterUnblockedActorIds(
      following && exactActorId
        ? await filterFollowingActorIds([exactActorId], currentActorId)
        : exactActorId
          ? [exactActorId]
          : [],
      currentActorId
    )
    const exactActorIdForResult = exactActorIds[0]
    const exactResultCount = exactActorIdForResult ? 1 : 0
    const exactActorIdsForPage =
      exactActorIdForResult && normalizedOffset === 0
        ? [exactActorIdForResult]
        : []
    const indexedLimit = Math.max(
      0,
      normalizedLimit - exactActorIdsForPage.length
    )
    const indexedOffset = Math.max(0, normalizedOffset - exactResultCount)
    const indexedActorIds =
      indexedLimit > 0
        ? await getMatchedDocumentIds({
            entityType: 'account',
            query,
            limit: indexedLimit,
            offset: indexedOffset,
            currentActorId,
            following,
            excludedEntityIds: exactActorIdForResult
              ? [exactActorIdForResult]
              : []
          })
        : []
    const excludedIndexedEntityIds = exactActorIdForResult
      ? [exactActorIdForResult]
      : []
    const fallbackLimit = indexedActorIds.length === 0 ? indexedLimit : 0
    const indexedTotal =
      fallbackLimit > 0 && indexedOffset > 0
        ? await getMatchedDocumentCount({
            entityType: 'account',
            query,
            currentActorId,
            following,
            excludedEntityIds: excludedIndexedEntityIds
          })
        : indexedActorIds.length
    const fallbackOffset = Math.max(0, indexedOffset - indexedTotal)
    const fallbackActorIds =
      fallbackLimit > 0
        ? await getFallbackAccountActorIds({
            query,
            limit: fallbackLimit,
            offset: fallbackOffset,
            currentActorId,
            following,
            excludedActorIds: [
              ...new Set([
                ...exactActorIdsForPage,
                ...indexedActorIds,
                ...(exactActorIdForResult ? [exactActorIdForResult] : [])
              ])
            ]
          })
        : []
    const combinedActorIds = [
      ...new Set([
        ...exactActorIdsForPage,
        ...indexedActorIds,
        ...fallbackActorIds
      ])
    ].slice(0, normalizedLimit)

    return hydrateAccounts(combinedActorIds)
  }

  async function searchStatuses({
    query,
    limit,
    offset,
    currentActorId,
    accountId,
    minStatusId,
    maxStatusId
  }: SearchStatusesParams): Promise<Status[]> {
    const usesCursor = Boolean(minStatusId || maxStatusId)
    const statusIds = await getMatchedDocumentIds({
      entityType: 'status',
      query,
      limit: normalizeLimit(limit),
      offset: usesCursor ? 0 : normalizeOffset(offset),
      currentActorId,
      accountId,
      minStatusId,
      maxStatusId
    })
    return statusDatabase.getStatusesByIds({
      statusIds,
      currentActorId,
      visibleToActorId: currentActorId
    })
  }

  async function getSearchHashtagsByIds({
    hashtagIds
  }: GetSearchHashtagsByIdsParams): Promise<Mastodon.SearchTag[]> {
    if (hashtagIds.length === 0) return []

    const rows = await getPublicHashtagRows(hashtagIds)
    const rowByHashtagId = rows.reduce((tagMap, row) => {
      const hashtagId = getHashtagId(row.name)
      if (!tagMap.has(hashtagId)) {
        tagMap.set(hashtagId, row)
      }
      return tagMap
    }, new Map<string, SQLTagSearchRow>())

    return hashtagIds.flatMap((hashtagId) => {
      const row = rowByHashtagId.get(hashtagId)
      if (!row) return []

      const name = getHashtagDisplayName(row.name)
      const parsed = Mastodon.SearchTag.safeParse({
        id: hashtagId,
        name,
        url: row.value || `https://${getConfiguredHost()}/tags/${name}`,
        history: []
      })
      return parsed.success ? [parsed.data] : []
    })
  }

  async function searchHashtags({
    query,
    limit,
    offset
  }: SearchHashtagsParams): Promise<Mastodon.SearchTag[]> {
    const hashtagIds = await getMatchedDocumentIds({
      entityType: 'hashtag',
      query,
      limit: normalizeLimit(limit),
      offset: normalizeOffset(offset)
    })
    return getSearchHashtagsByIds({ hashtagIds })
  }

  async function rebuildSearchIndex({
    clear = false,
    batchSize = DEFAULT_BATCH_SIZE,
    dryRun = false,
    syncMeilisearch = true
  }: SearchRebuildParams = {}): Promise<SearchRebuildResult> {
    const normalizedBatchSize = normalizeBatchSize(batchSize)
    const rebuildConcurrency = Math.min(
      DEFAULT_REBUILD_CONCURRENCY,
      normalizedBatchSize
    )
    const result: SearchRebuildResult = {
      accounts: 0,
      statuses: 0,
      hashtags: 0
    }

    if (dryRun) {
      const [accountCount, statusCount, hashtagCount] = await Promise.all([
        database('actors')
          .whereNull('deletionStatus')
          .count<{ count: string | number }>('* as count')
          .first(),
        database('statuses')
          .innerJoin('actors', 'statuses.actorId', 'actors.id')
          .whereIn('statuses.type', SEARCHABLE_STATUS_TYPES)
          .whereNull('actors.deletionStatus')
          .whereIn(
            'statuses.id',
            database('recipients')
              .select('statusId')
              .whereIn('actorId', PUBLIC_ACTIVITY_RECIPIENTS)
              .whereIn('type', ['to', 'cc'])
          )
          .countDistinct<{ count: string | number }>({
            count: 'statuses.id'
          })
          .first(),
        database('tags')
          .innerJoin('statuses', 'tags.statusId', 'statuses.id')
          .innerJoin('recipients', 'statuses.id', 'recipients.statusId')
          .innerJoin('actors', 'statuses.actorId', 'actors.id')
          .where('tags.type', 'hashtag')
          .whereIn('statuses.type', SEARCHABLE_STATUS_TYPES)
          .whereIn('recipients.actorId', PUBLIC_ACTIVITY_RECIPIENTS)
          .whereIn('recipients.type', ['to', 'cc'])
          .whereNull('actors.deletionStatus')
          .whereNotNull('tags.nameNormalized')
          .countDistinct<{ count: string | number }>({
            count: 'tags.nameNormalized'
          })
          .first()
      ])

      return {
        accounts: parseInt(String(accountCount?.count ?? '0'), 10),
        statuses: parseInt(String(statusCount?.count ?? '0'), 10),
        hashtags: parseInt(String(hashtagCount?.count ?? '0'), 10)
      }
    }

    if (clear) {
      await clearSearchIndex(syncMeilisearch)
    }

    let actorCursor: KeysetRow | null = null
    for (;;) {
      const actors: KeysetRow[] = await applyKeysetCursor(
        database<SQLActor>('actors')
          .whereNull('deletionStatus')
          .select<KeysetRow[]>('id', 'createdAt')
          .orderBy('createdAt', 'asc')
          .orderBy('id', 'asc')
          .limit(normalizedBatchSize),
        actorCursor
      )
      if (actors.length === 0) break

      const indexed = await rebuildActorSearchDocuments({
        actors,
        syncMeilisearch,
        concurrency: rebuildConcurrency
      })
      result.accounts += indexed.filter(Boolean).length
      actorCursor = actors[actors.length - 1]
    }

    let statusCursor: KeysetRow | null = null
    for (;;) {
      const statuses: KeysetRow[] = await applyKeysetCursor(
        database<SQLStatusSearchRow>('statuses')
          .innerJoin('actors', 'statuses.actorId', 'actors.id')
          .whereIn('statuses.type', SEARCHABLE_STATUS_TYPES)
          .whereNull('actors.deletionStatus')
          .select<KeysetRow[]>('statuses.id', 'statuses.createdAt')
          .orderBy('statuses.createdAt', 'asc')
          .orderBy('statuses.id', 'asc')
          .limit(normalizedBatchSize),
        statusCursor,
        'statuses.createdAt',
        'statuses.id'
      )
      if (statuses.length === 0) break

      const indexed = await rebuildStatusSearchDocuments({
        statuses,
        syncMeilisearch,
        concurrency: rebuildConcurrency
      })
      result.statuses += indexed.filter(Boolean).length
      statusCursor = statuses[statuses.length - 1]
    }

    let lastHashtagName: string | null = null
    for (;;) {
      let hashtagsQuery = database('tags')
        .innerJoin('statuses', 'tags.statusId', 'statuses.id')
        .innerJoin('recipients', 'statuses.id', 'recipients.statusId')
        .innerJoin('actors', 'statuses.actorId', 'actors.id')
        .where('tags.type', 'hashtag')
        .whereNotNull('tags.nameNormalized')
        .whereIn('statuses.type', SEARCHABLE_STATUS_TYPES)
        .whereIn('recipients.actorId', PUBLIC_ACTIVITY_RECIPIENTS)
        .whereIn('recipients.type', ['to', 'cc'])
        .whereNull('actors.deletionStatus')
        .groupBy('tags.nameNormalized')
        .select<{ nameNormalized: string }[]>('tags.nameNormalized')
        .orderBy('tags.nameNormalized', 'asc')
        .limit(normalizedBatchSize)

      if (lastHashtagName) {
        hashtagsQuery = hashtagsQuery.where(
          'tags.nameNormalized',
          '>',
          lastHashtagName
        )
      }

      const hashtags = await hashtagsQuery
      if (hashtags.length === 0) break

      const indexed = await upsertHashtagSearchDocuments({
        names: hashtags.map((hashtag) => hashtag.nameNormalized),
        syncMeilisearch
      })
      result.hashtags += indexed.filter(Boolean).length
      lastHashtagName = hashtags[hashtags.length - 1].nameNormalized
    }

    return result
  }

  return {
    searchAccounts,
    searchStatuses,
    searchHashtags,
    rebuildSearchIndex,
    clearSearchIndex,
    upsertActorSearchDocument,
    upsertStatusSearchDocument,
    upsertHashtagSearchDocument,
    upsertHashtagSearchDocuments,
    deleteSearchDocument,
    deleteSearchDocuments,
    getSearchHashtagsByIds
  }
}
