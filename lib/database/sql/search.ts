import { createHash } from 'crypto'
import { Knex } from 'knex'

import { getConfiguredHost } from '@/lib/config/configuredHost'
import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { normalizeAccountSearchQuery } from '@/lib/search/normalizeAccountSearchQuery'
import {
  buildSearchTermPrefixes,
  normalizeSearchTokens
} from '@/lib/search/tokenize'
import {
  ActorDatabase,
  DeleteSearchDocumentParams,
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

const DEFAULT_LIMIT = 20
const DEFAULT_BATCH_SIZE = 500
const DEFAULT_REBUILD_CONCURRENCY = 8
const MAX_QUERY_TERMS = 8
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
  visibility?: string | null
  searchText: string
  entityCreatedAt?: number | Date | string | null
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

const normalizeLimit = (limit?: number) => Math.max(1, limit ?? DEFAULT_LIMIT)
const normalizeOffset = (offset?: number) => Math.max(0, offset ?? 0)
const normalizeBatchSize = (batchSize?: number) =>
  Math.max(1, batchSize ?? DEFAULT_BATCH_SIZE)

const getSearchDocumentId = (entityType: SearchEntityType, entityId: string) =>
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

const applyKeysetCursor = (
  query: Knex.QueryBuilder,
  cursor: KeysetRow | null,
  createdAtColumn = 'createdAt',
  idColumn = 'id'
): Knex.QueryBuilder => {
  if (!cursor) return query

  return query.where((builder) => {
    builder
      .where(createdAtColumn, '>', cursor.createdAt)
      .orWhere((sameCreatedAt) => {
        sameCreatedAt
          .where(createdAtColumn, '=', cursor.createdAt)
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
  async function deleteSearchDocument({
    entityType,
    entityId
  }: DeleteSearchDocumentParams): Promise<void> {
    const documentId = getSearchDocumentId(entityType, entityId)
    await database.transaction(async (trx) => {
      // Keep child deletes explicit for SQLite connections without PRAGMA foreign_keys.
      await trx('search_terms').where('documentId', documentId).delete()
      await trx('search_documents').where('id', documentId).delete()
    })
  }

  async function replaceSearchDocument({
    entityType,
    entityId,
    actorId = null,
    visibility = null,
    searchText,
    entityCreatedAt = null,
    weightedText
  }: SearchDocumentInput): Promise<void> {
    const weightedTerms = getWeightedTerms({ searchText, weightedText })
    if (weightedTerms.length === 0) {
      await deleteSearchDocument({ entityType, entityId })
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

    await database.transaction(async (trx) => {
      await trx('search_documents')
        .insert({
          ...documentRow,
          createdAt: currentTime
        })
        .onConflict('id')
        .merge(documentRow)

      // Replacement upserts the parent row, so cascades do not clear prior terms.
      await trx('search_terms').where('documentId', documentId).delete()
      await trx('search_terms').insert(
        weightedTerms.map(({ term, weight }) => ({
          documentId,
          entityType,
          term,
          weight,
          createdAt: currentTime
        }))
      )
    })
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

  async function upsertActorSearchDocument({
    actorId
  }: UpsertSearchActorParams): Promise<boolean> {
    const actor = await database<SQLActor>('actors')
      .where('id', actorId)
      .first()

    if (!actor || actor.deletionStatus) {
      await deleteSearchDocument({ entityType: 'account', entityId: actorId })
      return false
    }

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
      searchText,
      entityCreatedAt: actor.createdAt,
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

  async function upsertStatusSearchDocument({
    statusId
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
      await deleteSearchDocument({ entityType: 'status', entityId: statusId })
      return false
    }

    const visibility = await getStatusVisibility(status.id)
    if (!visibility) {
      await deleteSearchDocument({ entityType: 'status', entityId: status.id })
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
      weightedText: [
        { text, weight: 5 },
        { text: tagText, weight: 4 },
        { text: summary, weight: 2 }
      ]
    })
    return true
  }

  async function getPublicHashtagRow(
    hashtagId: string
  ): Promise<SQLTagSearchRow | undefined> {
    const normalizedName = getNormalizedStoredHashtagName(hashtagId)
    return database('tags')
      .innerJoin('statuses', 'tags.statusId', 'statuses.id')
      .innerJoin('recipients', 'statuses.id', 'recipients.statusId')
      .innerJoin('actors', 'statuses.actorId', 'actors.id')
      .where('tags.type', 'hashtag')
      .whereIn('tags.nameNormalized', [normalizedName, hashtagId])
      .whereIn('statuses.type', SEARCHABLE_STATUS_TYPES)
      .whereIn('recipients.actorId', PUBLIC_ACTIVITY_RECIPIENTS)
      .whereIn('recipients.type', ['to', 'cc'])
      .whereNull('actors.deletionStatus')
      .select<
        SQLTagSearchRow[]
      >('tags.name', 'tags.value', 'tags.nameNormalized', 'tags.createdAt')
      .orderBy('tags.createdAt', 'asc')
      .first()
  }

  async function upsertHashtagSearchDocument({
    name
  }: UpsertSearchHashtagParams): Promise<boolean> {
    const hashtagId = getHashtagId(name)
    if (!hashtagId) return false

    const tag = await getPublicHashtagRow(hashtagId)
    if (!tag) {
      await deleteSearchDocument({
        entityType: 'hashtag',
        entityId: hashtagId
      })
      return false
    }

    const displayName = getHashtagDisplayName(tag.name)
    await replaceSearchDocument({
      entityType: 'hashtag',
      entityId: hashtagId,
      searchText: [displayName, hashtagId].join(' '),
      entityCreatedAt: tag.createdAt,
      weightedText: [
        { text: displayName, weight: 8 },
        { text: hashtagId, weight: 8 }
      ]
    })
    return true
  }

  async function clearSearchIndex(): Promise<void> {
    await database.transaction(async (trx) => {
      // Keep child deletes explicit for SQLite connections without PRAGMA foreign_keys.
      await trx('search_terms').delete()
      await trx('search_documents').delete()
    })
  }

  async function getSearchQueryTerms(query: string) {
    return normalizeSearchTokens(query)
      .filter((term) => term.length >= 2)
      .slice(0, MAX_QUERY_TERMS)
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

    const buildTermMatchesQuery = () =>
      database('search_terms')
        .select('documentId')
        .sum({ searchScore: 'weight' })
        .where('entityType', entityType)
        .whereIn('term', queryTerms)
        .groupBy('documentId')
        .havingRaw('COUNT(DISTINCT ??) = ?', ['term', queryTerms.length])

    const getStatusSearchCursor = async (statusId: string) =>
      database('search_documents')
        .innerJoin(
          buildTermMatchesQuery().as('term_matches'),
          'search_documents.id',
          'term_matches.documentId'
        )
        .where('search_documents.entityType', 'status')
        .where('search_documents.searchable', true)
        .where('search_documents.id', getSearchDocumentId('status', statusId))
        .select<
          SearchCursorRow[]
        >('search_documents.entityId', 'search_documents.entityIdHash', 'search_documents.entityCreatedAt', 'term_matches.searchScore')
        .first()

    const applyStatusSearchCursor = (
      direction: 'before' | 'after',
      cursor: SearchCursorRow
    ) => {
      const scoreOperator = direction === 'before' ? '>' : '<'
      const createdAtOperator = direction === 'before' ? '>' : '<'
      const entityIdOperator = direction === 'before' ? '>' : '<'

      documentsQuery = documentsQuery.where((builder) => {
        builder
          .where('term_matches.searchScore', scoreOperator, cursor.searchScore)
          .orWhere((sameScore) => {
            sameScore
              .where('term_matches.searchScore', '=', cursor.searchScore)
              .where((sameScoreTie) => {
                sameScoreTie
                  .where(
                    'search_documents.entityCreatedAt',
                    createdAtOperator,
                    cursor.entityCreatedAt
                  )
                  .orWhere((sameCreatedAt) => {
                    sameCreatedAt
                      .where(
                        'search_documents.entityCreatedAt',
                        '=',
                        cursor.entityCreatedAt
                      )
                      .where(
                        'search_documents.entityIdHash',
                        entityIdOperator,
                        cursor.entityIdHash
                      )
                  })
              })
          })
      })
    }

    let documentsQuery = database('search_documents')
      .innerJoin(
        buildTermMatchesQuery().as('term_matches'),
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

    if (entityType === 'account' && following) {
      if (!currentActorId) return []
      documentsQuery = documentsQuery
        .innerJoin(
          'follows',
          'follows.targetActorId',
          'search_documents.entityId'
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

    if (entityType === 'status' && minStatusId) {
      const cursor = await getStatusSearchCursor(minStatusId)
      if (cursor?.entityCreatedAt) {
        applyStatusSearchCursor('before', cursor)
      }
    }

    if (entityType === 'status' && maxStatusId) {
      const cursor = await getStatusSearchCursor(maxStatusId)
      if (cursor?.entityCreatedAt) {
        applyStatusSearchCursor('after', cursor)
      }
    }

    const rows = await documentsQuery
      .select<{ entityId: string }[]>('search_documents.entityId')
      .orderBy('term_matches.searchScore', 'desc')
      .orderBy('search_documents.entityCreatedAt', 'desc')
      .orderBy('search_documents.entityIdHash', 'desc')
      .limit(limit)
      .offset(offset)

    return rows.map((row) => row.entityId)
  }

  const getExactAccountActorId = async (
    query: string
  ): Promise<string | null> => {
    const cleanedQuery = normalizeAccountSearchQuery(query)
    if (!cleanedQuery) return null

    const parts = cleanedQuery.split('@')
    if (parts.length > 2) return null

    const [username, domain = getConfiguredHost()] = parts
    if (!username || !domain) return null

    const actor = await actorDatabase.getActorFromUsername({
      username,
      domain
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

  const hydrateAccounts = (actorIds: string[]) =>
    actorDatabase.getMastodonActorsFromIds({ ids: actorIds })

  async function searchAccounts({
    query,
    limit,
    offset,
    currentActorId,
    following = false,
    resolve = false
  }: SearchAccountsParams): Promise<Mastodon.Account[]> {
    const normalizedLimit = normalizeLimit(limit)
    const normalizedOffset = normalizeOffset(offset)
    const shouldTryExactAccount = resolve || query.includes('@')
    const exactActorId = shouldTryExactAccount
      ? await getExactAccountActorId(query)
      : null
    const exactActorIds =
      following && exactActorId
        ? await filterFollowingActorIds([exactActorId], currentActorId)
        : exactActorId
          ? [exactActorId]
          : []
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
    const combinedActorIds = [
      ...new Set([...exactActorIdsForPage, ...indexedActorIds])
    ]

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
    const statusIds = await getMatchedDocumentIds({
      entityType: 'status',
      query,
      limit: normalizeLimit(limit),
      offset: normalizeOffset(offset),
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

    const rows = await mapWithConcurrency(
      hashtagIds,
      Math.min(DEFAULT_REBUILD_CONCURRENCY, hashtagIds.length),
      async (hashtagId) => ({
        hashtagId,
        row: await getPublicHashtagRow(hashtagId)
      })
    )

    return rows.flatMap(({ hashtagId, row }) => {
      if (!row) return []

      const name = getHashtagDisplayName(row.name)
      return Mastodon.SearchTag.parse({
        id: hashtagId,
        name,
        url: row.value || `https://${getConfiguredHost()}/tags/${name}`,
        history: []
      })
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
    dryRun = false
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
      await clearSearchIndex()
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

      const indexed = await mapWithConcurrency(
        actors,
        rebuildConcurrency,
        (actor) => upsertActorSearchDocument({ actorId: actor.id })
      )
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

      const indexed = await mapWithConcurrency(
        statuses,
        rebuildConcurrency,
        (status) => upsertStatusSearchDocument({ statusId: status.id })
      )
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

      const indexed = await mapWithConcurrency(
        hashtags,
        rebuildConcurrency,
        (hashtag) =>
          upsertHashtagSearchDocument({ name: hashtag.nameNormalized })
      )
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
    deleteSearchDocument,
    getSearchHashtagsByIds
  }
}
