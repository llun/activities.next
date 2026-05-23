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
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

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
  nameNormalized: string
  postCount: number | string
  lastPostAt: number | Date | null
}

export const normalizeHashtagSearchName = (hashtag: string) => {
  const bare = hashtag.trim().replace(/^#/, '').toLowerCase()
  return bare
}

const getHashtagEntityId = (hashtag: string) =>
  normalizeHashtagSearchName(hashtag)

const getTagUrl = (name: string) => {
  const host = getConfig().host
  const baseURL = host.includes('://') ? host : `https://${host}`
  return `${baseURL}/tags/${encodeURIComponent(name)}`
}

const getHashtagSearchAggregates = async (
  database: Knex,
  normalizedTagNames: string[]
) => {
  if (normalizedTagNames.length === 0) return []

  return database('tags')
    .select<{ nameNormalized: string }[]>('tags.nameNormalized')
    .innerJoin('statuses', 'statuses.id', 'tags.statusId')
    .innerJoin('recipients', 'recipients.statusId', 'statuses.id')
    .where('tags.type', 'hashtag')
    .whereIn('tags.nameNormalized', normalizedTagNames)
    .where('recipients.actorId', ACTIVITY_STREAM_PUBLIC)
    .whereIn('statuses.type', [StatusType.enum.Note, StatusType.enum.Poll])
    .countDistinct('statuses.id as postCount')
    .max('statuses.createdAt as lastPostAt')
    .groupBy('tags.nameNormalized') as Promise<HashtagSearchAggregate[]>
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
        .map((name) => `#${name}`)
    )
  ]
  if (normalizedTagNames.length === 0) return

  const aggregates = await getHashtagSearchAggregates(
    database,
    normalizedTagNames
  )
  const aggregateByName = new Map(
    aggregates.map((aggregate) => [aggregate.nameNormalized, aggregate])
  )
  const namesToDelete = normalizedTagNames
    .filter((name) => Number(aggregateByName.get(name)?.postCount ?? 0) === 0)
    .map((name) => normalizeHashtagSearchName(name))

  if (namesToDelete.length > 0) {
    await database(SEARCH_DOCUMENTS_TABLE)
      .where('entityType', 'hashtag')
      .whereIn('entityId', namesToDelete)
      .delete()
  }

  const currentTime = new Date()
  const rows = aggregates
    .filter((aggregate) => Number(aggregate.postCount ?? 0) > 0)
    .map((aggregate) => {
      const name = normalizeHashtagSearchName(aggregate.nameNormalized)
      const lastPostAt = aggregate.lastPostAt
        ? new Date(getCompatibleTime(aggregate.lastPostAt))
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

  await database(SEARCH_DOCUMENTS_TABLE)
    .insert(rows)
    .onConflict(['entityType', 'entityId'])
    .merge(['documentText', 'postCount', 'lastPostAt', 'updatedAt'])
}

export const indexHashtagSearchDocument = async (
  database: Knex,
  { hashtag }: { hashtag: string }
): Promise<void> => {
  await reindexHashtagSearchDocuments(database, [hashtag])
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
  const query = database('tags')
    .where('type', 'hashtag')
    .whereNotNull('nameNormalized')
    .distinct<{ nameNormalized: string }[]>('nameNormalized')
    .orderBy('nameNormalized', 'asc')

  if (afterId) query.where('nameNormalized', '>', `#${afterId}`)

  const rows = await query.limit(limit)
  await reindexHashtagSearchDocuments(
    database,
    rows.map((row) => row.nameNormalized)
  )

  return {
    indexed: rows.length,
    nextCursor:
      rows.length === limit
        ? normalizeHashtagSearchName(rows[rows.length - 1].nameNormalized)
        : null
  }
}
