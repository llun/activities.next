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
  name: string
  postCount: number | string
  lastPostAt: number | Date | null
}

const SQLITE_MAX_BINDINGS = 999
const PUBLIC_ACTIVITY_RECIPIENTS = [
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
]
const HASHTAG_AGGREGATE_FIXED_BINDINGS =
  1 + PUBLIC_ACTIVITY_RECIPIENTS.length + 2
const HASHTAG_STORAGE_NAMES_PER_SEARCH_NAME = 2

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

const getClientName = (database: Knex) => String(database.client.config.client)

const getWhereInBatchSize = (database: Knex, reservedBindings = 0) => {
  if (!getClientName(database).includes('sqlite'))
    return Number.POSITIVE_INFINITY
  return Math.max(1, SQLITE_MAX_BINDINGS - reservedBindings)
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
  const hashtagBatchSize = Math.max(
    1,
    Math.floor(
      getWhereInBatchSize(database, HASHTAG_AGGREGATE_FIXED_BINDINGS) /
        HASHTAG_STORAGE_NAMES_PER_SEARCH_NAME
    )
  )
  const aggregateByName = new Map<string, HashtagSearchAggregate>()

  for (const hashtagNameChunk of chunkArray(hashtagNames, hashtagBatchSize)) {
    const lookupNames = [
      ...new Set(hashtagNameChunk.flatMap(getHashtagStorageNames))
    ]
    const rows = (await database('tags')
      .select({ name: 'tags.nameNormalized' })
      .countDistinct({ postCount: 'statuses.id' })
      .max({ lastPostAt: 'statuses.createdAt' })
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
      .groupBy('tags.nameNormalized')) as HashtagSearchAggregateRow[]

    for (const row of rows) {
      const name = normalizeHashtagSearchName(row.name)
      if (!requestedNames.has(name)) continue

      const existingAggregate = aggregateByName.get(name)
      const lastPostAt = row.lastPostAt
        ? getCompatibleTime(row.lastPostAt)
        : null
      if (!existingAggregate) {
        aggregateByName.set(name, {
          name,
          postCount: Number(row.postCount ?? 0),
          lastPostAt
        })
        continue
      }

      existingAggregate.postCount += Number(row.postCount ?? 0)
      existingAggregate.lastPostAt =
        existingAggregate.lastPostAt && lastPostAt
          ? Math.max(existingAggregate.lastPostAt, lastPostAt)
          : (existingAggregate.lastPostAt ?? lastPostAt)
    }
  }

  return [...aggregateByName.values()]
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
      getWhereInBatchSize(database, 1)
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
      .onConflict('id')
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

  await applySearchDocumentFilter({ database, query, q })
  applySearchDocumentOrdering({ database, query, entityType: 'hashtag', q })

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
  const query = database('tags')
    .where('type', 'hashtag')
    .whereNotNull('nameNormalized')
    .distinct<{ normalizedName: string }[]>({
      normalizedName: 'tags.nameNormalized'
    })
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
    indexed: normalizedNames.length,
    nextCursor:
      rows.length === limit ? rows[rows.length - 1].normalizedName : null
  }
}
