import { Knex } from 'knex'

import { getConfig } from '@/lib/config'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  KnexConnection,
  chunkArray,
  getInsertBatchSize,
  getWhereInBatchSize,
  isKnexTransaction,
  isSQLiteClient
} from '@/lib/database/sql/utils/knex'
import {
  ReindexSearchDocumentsParams,
  ReindexSearchDocumentsResult,
  SearchHashtag,
  SearchHashtagsParams
} from '@/lib/types/database/operations'
import { StatusType } from '@/lib/types/domain/status'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'

import {
  SEARCH_DOCUMENTS_TABLE,
  applySearchDocumentFilter,
  applySearchDocumentOrdering,
  deleteSearchDocument,
  getSearchDocumentId,
  normalizeSearchText,
  toSearchDocument
} from './documents'

type SQLSearchDocumentRow = Parameters<typeof toSearchDocument>[0]
type HashtagSearchAggregate = {
  name: string
  postCount: number
  lastPostAt: number | null
}
type HashtagSearchAggregateRow = {
  name: string
  postCount: number | string
  lastPostAt: number | Date | null
}
type HashtagSearchDocumentRow = {
  id: string
  entityType: 'hashtag'
  entityId: string
  documentText: string
  actorId: null
  visibility: null
  entityCreatedAt: null
  discoverable: null
  postCount: number | null
  lastPostAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const PUBLIC_ACTIVITY_RECIPIENTS = [
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
]
const HASHTAG_AGGREGATE_FIXED_BINDINGS =
  1 + PUBLIC_ACTIVITY_RECIPIENTS.length + 2 + 1
const HASHTAG_STORAGE_NAMES_PER_SEARCH_NAME = 2
const STALE_HASHTAG_SEARCH_CLEANUP_BATCH_SIZE = 100

export const normalizeHashtagSearchName = (hashtag: string) => {
  const bare = hashtag.trim().replace(/^#+/, '').toLowerCase()
  return bare
}

const getHashtagEntityId = (hashtag: string) =>
  normalizeHashtagSearchName(hashtag)

const getHashtagStorageNames = (hashtag: string) => {
  const name = getHashtagEntityId(hashtag)
  return name ? [name, `#${name}`] : []
}

const getTagUrl = (name: string) => {
  const host = getConfig().host
  const baseURL = host.includes('://') ? host : `https://${host}`
  return `${baseURL}/tags/${encodeURIComponent(name)}`
}

// Strips the optional leading `#` from `tags.nameNormalized` in SQL so both
// stored forms (`bare` and `#bare`) group/match as one normalized tag name.
// Exported for other tag aggregations (e.g. trends) that must count the same
// rows hashtag search counts.
export const getNormalizedHashtagNameSQL = (database: KnexConnection) => {
  if (isSQLiteClient(database)) {
    return {
      sql: 'lower(ltrim(??, ?))',
      bindings: ['tags.nameNormalized', '#']
    }
  }

  return {
    sql: "lower(trim(leading '#' from ??))",
    bindings: ['tags.nameNormalized']
  }
}

const getHashtagSearchAggregates = async (
  database: KnexConnection,
  hashtagNames: string[]
) => {
  if (hashtagNames.length === 0) return []

  const requestedNames = new Set(hashtagNames)
  const hashtagBatchSize = Math.max(
    1,
    Math.floor(
      getWhereInBatchSize(database, HASHTAG_AGGREGATE_FIXED_BINDINGS, 1000) /
        HASHTAG_STORAGE_NAMES_PER_SEARCH_NAME
    )
  )
  const aggregateByName = new Map<string, HashtagSearchAggregate>()

  for (const hashtagNameChunk of chunkArray(hashtagNames, hashtagBatchSize)) {
    const lookupNames = [
      ...new Set(hashtagNameChunk.flatMap(getHashtagStorageNames))
    ]
    const normalizedNameSQL = getNormalizedHashtagNameSQL(database)
    const distinctStatusHashtags = database('tags')
      .distinct(
        database.raw(`${normalizedNameSQL.sql} as ??`, [
          ...normalizedNameSQL.bindings,
          'name'
        ]),
        database.raw('?? as ??', ['statuses.id', 'statusId']),
        database.raw('?? as ??', ['statuses.createdAt', 'statusCreatedAt'])
      )
      .innerJoin('statuses', 'statuses.id', 'tags.statusId')
      .where('tags.type', 'hashtag')
      .whereIn('tags.nameNormalized', lookupNames)
      .whereExists(function () {
        this.select(database.raw('1'))
          .from('recipients')
          .whereRaw('?? = ??', ['recipients.statusId', 'statuses.id'])
          .whereIn('recipients.actorId', PUBLIC_ACTIVITY_RECIPIENTS)
      })
      .whereIn('statuses.type', [StatusType.enum.Note, StatusType.enum.Poll])
      .as('hashtag_statuses')

    const rows = (await database
      .from(distinctStatusHashtags)
      .select({ name: 'hashtag_statuses.name' })
      .count({ postCount: 'hashtag_statuses.statusId' })
      .max({ lastPostAt: 'hashtag_statuses.statusCreatedAt' })
      .groupBy('hashtag_statuses.name')) as HashtagSearchAggregateRow[]

    for (const row of rows) {
      const name = normalizeHashtagSearchName(row.name)
      if (!requestedNames.has(name)) continue

      const existingAggregate = aggregateByName.get(name)
      const compatibleLastPostAt =
        row.lastPostAt !== null && row.lastPostAt !== undefined
          ? getCompatibleTime(row.lastPostAt)
          : null
      if (!existingAggregate) {
        aggregateByName.set(name, {
          name,
          postCount: Number(row.postCount ?? 0),
          lastPostAt: compatibleLastPostAt
        })
        continue
      }

      existingAggregate.postCount += Number(row.postCount ?? 0)
      existingAggregate.lastPostAt =
        existingAggregate.lastPostAt !== null && compatibleLastPostAt !== null
          ? Math.max(existingAggregate.lastPostAt, compatibleLastPostAt)
          : (existingAggregate.lastPostAt ?? compatibleLastPostAt)
    }
  }

  return [...aggregateByName.values()]
}

const getHashtagSearchDocumentRow = ({
  aggregate,
  currentTime,
  name
}: {
  aggregate?: HashtagSearchAggregate
  currentTime: Date
  name: string
}): HashtagSearchDocumentRow => {
  const lastPostAt =
    aggregate?.lastPostAt !== null && aggregate?.lastPostAt !== undefined
      ? new Date(aggregate.lastPostAt)
      : null
  return {
    id: getSearchDocumentId({
      entityType: 'hashtag',
      entityId: name
    }),
    entityType: 'hashtag',
    entityId: name,
    documentText: normalizeSearchText(`${name} #${name}`),
    actorId: null,
    visibility: null,
    entityCreatedAt: null,
    discoverable: null,
    postCount: aggregate ? Number(aggregate.postCount ?? 0) : null,
    lastPostAt,
    createdAt: currentTime,
    updatedAt: currentTime
  }
}

const deleteStaleHashtagSearchDocuments = async (database: KnexConnection) => {
  const batchSize = STALE_HASHTAG_SEARCH_CLEANUP_BATCH_SIZE
  let afterEntityId: string | null = null

  // search_documents has a covering (entityType, entityId) index. Walk that
  // index in bounded cursor pages, then do one batched tags lookup with
  // WHERE IN per page instead of one lookup per document.
  while (true) {
    const query = database(SEARCH_DOCUMENTS_TABLE)
      .where('entityType', 'hashtag')
      .select<{ entityId: string }[]>('entityId')
      .orderBy('entityId', 'asc')
      .limit(batchSize)

    if (afterEntityId) {
      query.where('entityId', '>', afterEntityId)
    }

    const rows = await query
    if (rows.length === 0) return

    afterEntityId = rows[rows.length - 1].entityId
    const names = rows.map((row) => row.entityId)
    const lookupNames = [...new Set(names.flatMap(getHashtagStorageNames))]
    const liveNames = new Set<string>()

    if (lookupNames.length > 0) {
      const tagRows = await database('tags')
        .where('type', 'hashtag')
        .whereNotNull('nameNormalized')
        .whereIn('nameNormalized', lookupNames)
        .select<{ normalizedName: string }[]>({
          normalizedName: 'tags.nameNormalized'
        })
        .distinct()

      for (const tagRow of tagRows) {
        const normalizedName = normalizeHashtagSearchName(tagRow.normalizedName)
        if (normalizedName.length > 0) {
          liveNames.add(normalizedName)
        }
      }
    }

    const staleNames = names.filter((name) => !liveNames.has(name))
    if (staleNames.length > 0) {
      await database(SEARCH_DOCUMENTS_TABLE)
        .where('entityType', 'hashtag')
        .whereIn('entityId', staleNames)
        .delete()
    }
  }
}

const insertHashtagSearchDocumentPlaceholders = async (
  trx: Knex.Transaction,
  names: string[],
  currentTime: Date
) => {
  const rows = names.map((name) =>
    getHashtagSearchDocumentRow({ currentTime, name })
  )
  const batchSize = getInsertBatchSize(trx, rows[0], 1000)
  for (const rowChunk of chunkArray(rows, batchSize)) {
    await trx(SEARCH_DOCUMENTS_TABLE).insert(rowChunk).onConflict('id').ignore()
  }
}

const lockHashtagSearchDocuments = async (
  trx: Knex.Transaction,
  names: string[]
) => {
  // SQLite write transactions are serialized for this reindex flow, so there is
  // no row-level lock equivalent to take before reading and writing aggregates.
  if (isSQLiteClient(trx)) return

  for (const nameChunk of chunkArray(names, getWhereInBatchSize(trx, 1))) {
    await trx(SEARCH_DOCUMENTS_TABLE)
      .select('id')
      .where('entityType', 'hashtag')
      .whereIn('entityId', nameChunk)
      .forUpdate()
  }
}

const reindexHashtagSearchDocuments = async (
  database: KnexConnection,
  hashtags: string[]
) => {
  const normalizedTagNames = [
    ...new Set(
      hashtags
        .map((hashtag) => getHashtagEntityId(hashtag))
        .filter((name) => name.length > 0)
    )
  ]
  if (normalizedTagNames.length === 0) return

  const reindexInTransaction = async (trx: Knex.Transaction) => {
    const currentTime = new Date()
    await insertHashtagSearchDocumentPlaceholders(
      trx,
      normalizedTagNames,
      currentTime
    )
    await lockHashtagSearchDocuments(trx, normalizedTagNames)

    const aggregates = await getHashtagSearchAggregates(trx, normalizedTagNames)
    const aggregateByName = new Map(
      aggregates.map((aggregate) => [aggregate.name, aggregate])
    )
    const namesToDelete = normalizedTagNames.filter(
      (name) => Number(aggregateByName.get(name)?.postCount ?? 0) === 0
    )

    if (namesToDelete.length > 0) {
      for (const nameChunk of chunkArray(
        namesToDelete,
        getWhereInBatchSize(trx, 1)
      )) {
        await trx(SEARCH_DOCUMENTS_TABLE)
          .where('entityType', 'hashtag')
          .whereIn('entityId', nameChunk)
          .delete()
      }
    }

    const rows = aggregates
      .filter((aggregate) => Number(aggregate.postCount ?? 0) > 0)
      .map((aggregate) =>
        getHashtagSearchDocumentRow({
          aggregate,
          currentTime,
          name: aggregate.name
        })
      )

    if (rows.length === 0) {
      return
    }

    const batchSize = getInsertBatchSize(trx, rows[0], 1000)
    for (const rowChunk of chunkArray(rows, batchSize)) {
      await trx(SEARCH_DOCUMENTS_TABLE)
        .insert(rowChunk)
        .onConflict('id')
        .merge(['documentText', 'postCount', 'lastPostAt', 'updatedAt'])
    }
  }

  if (isKnexTransaction(database)) {
    await reindexInTransaction(database)
    return
  }

  await database.transaction(reindexInTransaction)
}

export const indexHashtagSearchDocument = async (
  database: Knex,
  { hashtag }: { hashtag: string }
): Promise<void> => {
  await reindexHashtagSearchDocuments(database, [hashtag])
}

export const indexHashtagSearchDocuments = async (
  database: Knex,
  { hashtags }: { hashtags: string[] }
): Promise<void> => {
  await reindexHashtagSearchDocuments(database, hashtags)
}

export const deleteHashtagSearchDocument = async (
  database: Knex,
  { hashtag }: { hashtag: string }
): Promise<void> => {
  await deleteSearchDocument(database, {
    entityType: 'hashtag',
    entityId: getHashtagEntityId(hashtag)
  })
}

export const searchHashtags = async (
  database: Knex,
  { q, limit, offset = 0 }: SearchHashtagsParams
): Promise<SearchHashtag[]> => {
  const query = database<SQLSearchDocumentRow>(SEARCH_DOCUMENTS_TABLE)
    .select('search_documents.*')
    .where('search_documents.entityType', 'hashtag')

  await applySearchDocumentFilter({ database, query, q })
  applySearchDocumentOrdering({ database, query, entityType: 'hashtag', q })

  const rows = await query.limit(limit).offset(offset)
  return rows.map((row) => {
    const document = toSearchDocument(row)
    return {
      name: document.entityId,
      url: getTagUrl(document.entityId),
      // Trend history is not indexed yet; keep the Mastodon-compatible field empty.
      history: [],
      following: false,
      postCount: document.postCount ?? 0,
      lastPostAt: document.lastPostAt
    }
  })
}

/**
 * Reindex one cursor page of hashtag search documents.
 *
 * Stale hashtag document cleanup is tied to a full reindex run that starts
 * with a null cursor. Resumed or sharded callers that pass a non-null afterId
 * skip that cleanup pass to avoid repeating the bounded table scan per page.
 */
export const reindexSearchHashtags = async (
  database: Knex,
  { afterId = null, limit = 500 }: ReindexSearchDocumentsParams = {}
): Promise<ReindexSearchDocumentsResult> => {
  if (afterId === null) {
    await deleteStaleHashtagSearchDocuments(database)
  }

  const query = database('tags')
    .where('type', 'hashtag')
    .whereNotNull('nameNormalized')
    .select<{ normalizedName: string }[]>({
      normalizedName: 'tags.nameNormalized'
    })
    .distinct()
    .orderBy('tags.nameNormalized', 'asc')

  if (afterId) {
    query.where('tags.nameNormalized', '>', afterId)
  }

  const rows = await query.limit(limit)
  const normalizedNames = [
    ...new Set(
      rows
        .map((row) => normalizeHashtagSearchName(row.normalizedName))
        .filter((name) => name.length > 0)
    )
  ]
  await reindexHashtagSearchDocuments(database, normalizedNames)

  return {
    indexed: rows.length,
    nextCursor:
      rows.length === limit ? rows[rows.length - 1].normalizedName : null
  }
}
