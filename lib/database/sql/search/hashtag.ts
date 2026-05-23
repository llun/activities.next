import { Knex } from 'knex'

import { getConfig } from '@/lib/config'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
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
  nameNormalized: string
  statusId: string
  statusCreatedAt: number | Date
}

const SQLITE_MAX_BINDINGS = 999
const PUBLIC_ACTIVITY_RECIPIENTS = [
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
]

export const normalizeHashtagSearchName = (hashtag: string) => {
  const bare = hashtag.trim().replace(/^#/, '').toLowerCase()
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

const getClientName = (database: Knex) => String(database.client.config.client)

const getWhereInBatchSize = (database: Knex) => {
  if (!getClientName(database).includes('sqlite'))
    return Number.POSITIVE_INFINITY
  return SQLITE_MAX_BINDINGS
}

const chunkArray = <T>(items: T[], size: number) => {
  const chunkSize = Number.isFinite(size) ? size : Math.max(items.length, 1)
  const chunks: T[][] = []
  for (let start = 0; start < items.length; start += chunkSize) {
    chunks.push(items.slice(start, start + chunkSize))
  }
  return chunks
}

const getHashtagSearchAggregates = async (
  database: Knex,
  hashtagNames: string[]
) => {
  if (hashtagNames.length === 0) return []

  const requestedNames = new Set(hashtagNames)
  const lookupNames = [...new Set(hashtagNames.flatMap(getHashtagStorageNames))]
  const aggregateByName = new Map<
    string,
    { statusIds: Set<string>; lastPostAt: number | null }
  >()

  for (const lookupNameChunk of chunkArray(
    lookupNames,
    getWhereInBatchSize(database)
  )) {
    const rows = await database('tags')
      .distinct<
        HashtagSearchAggregateRow[]
      >('tags.nameNormalized', 'statuses.id as statusId', 'statuses.createdAt as statusCreatedAt')
      .innerJoin('statuses', 'statuses.id', 'tags.statusId')
      .innerJoin('recipients', 'recipients.statusId', 'statuses.id')
      .where('tags.type', 'hashtag')
      .whereIn('tags.nameNormalized', lookupNameChunk)
      .whereIn('recipients.actorId', PUBLIC_ACTIVITY_RECIPIENTS)
      .whereIn('statuses.type', [StatusType.enum.Note, StatusType.enum.Poll])

    for (const row of rows) {
      const name = normalizeHashtagSearchName(row.nameNormalized)
      if (!requestedNames.has(name)) continue

      const aggregate = aggregateByName.get(name) ?? {
        statusIds: new Set<string>(),
        lastPostAt: null
      }
      aggregate.statusIds.add(row.statusId)
      const statusCreatedAt = getCompatibleTime(row.statusCreatedAt)
      aggregate.lastPostAt =
        aggregate.lastPostAt === null
          ? statusCreatedAt
          : Math.max(aggregate.lastPostAt, statusCreatedAt)
      aggregateByName.set(name, aggregate)
    }
  }

  return [...aggregateByName.entries()].map(
    ([name, aggregate]): HashtagSearchAggregate => ({
      name,
      postCount: aggregate.statusIds.size,
      lastPostAt: aggregate.lastPostAt
    })
  )
}

const getSearchDocumentInsertBatchSize = (
  database: Knex,
  row: Record<string, unknown>
) => {
  const clientName = getClientName(database)
  if (!clientName.includes('sqlite')) return Number.POSITIVE_INFINITY

  const columnCount = Math.max(1, Object.keys(row).length)
  return Math.max(1, Math.floor(SQLITE_MAX_BINDINGS / columnCount))
}

const reindexHashtagSearchDocuments = async (
  database: Knex,
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

  const aggregates = await getHashtagSearchAggregates(
    database,
    normalizedTagNames
  )
  const aggregateByName = new Map(
    aggregates.map((aggregate) => [aggregate.name, aggregate])
  )
  const namesToDelete = normalizedTagNames.filter(
    (name) => Number(aggregateByName.get(name)?.postCount ?? 0) === 0
  )

  if (namesToDelete.length > 0) {
    for (const nameChunk of chunkArray(
      namesToDelete,
      getWhereInBatchSize(database)
    )) {
      await database(SEARCH_DOCUMENTS_TABLE)
        .where('entityType', 'hashtag')
        .whereIn('entityId', nameChunk)
        .delete()
    }
  }

  const currentTime = new Date()
  const rows = aggregates
    .filter((aggregate) => Number(aggregate.postCount ?? 0) > 0)
    .map((aggregate) => {
      const name = aggregate.name
      const lastPostAt = aggregate.lastPostAt
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
        postCount: Number(aggregate.postCount ?? 0),
        lastPostAt,
        createdAt: currentTime,
        updatedAt: currentTime
      }
    })

  if (rows.length === 0) {
    return
  }

  const batchSize = getSearchDocumentInsertBatchSize(database, rows[0])
  for (let start = 0; start < rows.length; start += batchSize) {
    await database(SEARCH_DOCUMENTS_TABLE)
      .insert(rows.slice(start, start + batchSize))
      .onConflict(['entityType', 'entityId'])
      .merge(['documentText', 'postCount', 'lastPostAt', 'updatedAt'])
  }
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

  applySearchDocumentFilter({ database, query, q })
  applySearchDocumentOrdering({ query, q })

  const rows = await query.limit(limit).offset(offset)
  return rows.map((row) => {
    const document = toSearchDocument(row)
    return {
      name: document.entityId,
      url: getTagUrl(document.entityId),
      history: [],
      following: false,
      postCount: document.postCount ?? 0,
      lastPostAt: document.lastPostAt
    }
  })
}

export const reindexSearchHashtags = async (
  database: Knex,
  { afterId = null, limit = 500 }: ReindexSearchDocumentsParams = {}
): Promise<ReindexSearchDocumentsResult> => {
  const normalizedNameSQL = 'case when ?? like ? then substr(??, 2) else ?? end'
  const normalizedNameBindings = [
    'tags.nameNormalized',
    '#%',
    'tags.nameNormalized',
    'tags.nameNormalized'
  ]
  const query = database('tags')
    .where('type', 'hashtag')
    .whereNotNull('nameNormalized')
    .distinct<{ normalizedName: string }[]>(
      database.raw(`${normalizedNameSQL} as ??`, [
        ...normalizedNameBindings,
        'normalizedName'
      ])
    )
    .orderBy('normalizedName', 'asc')

  if (afterId) {
    query.whereRaw(`${normalizedNameSQL} > ?`, [
      ...normalizedNameBindings,
      normalizeHashtagSearchName(afterId)
    ])
  }

  const rows = await query.limit(limit)
  await reindexHashtagSearchDocuments(
    database,
    rows.map((row) => row.normalizedName)
  )

  return {
    indexed: rows.length,
    nextCursor:
      rows.length === limit
        ? normalizeHashtagSearchName(rows[rows.length - 1].normalizedName)
        : null
  }
}
