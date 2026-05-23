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
  normalizeSearchText,
  toSearchDocument,
  upsertSearchDocument
} from './documents'

type SQLSearchDocumentRow = Parameters<typeof toSearchDocument>[0]
type HashtagSearchAggregate = {
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

export const indexHashtagSearchDocument = async (
  database: Knex,
  { hashtag }: { hashtag: string }
): Promise<void> => {
  const name = getHashtagEntityId(hashtag)
  if (!name) return

  const normalizedTagName = `#${name}`
  const aggregate = await database('tags')
    .innerJoin('statuses', 'statuses.id', 'tags.statusId')
    .innerJoin('recipients', 'recipients.statusId', 'statuses.id')
    .where('tags.type', 'hashtag')
    .where('tags.nameNormalized', normalizedTagName)
    .where('recipients.actorId', ACTIVITY_STREAM_PUBLIC)
    .whereIn('statuses.type', [StatusType.enum.Note, StatusType.enum.Poll])
    .countDistinct('statuses.id as postCount')
    .max('statuses.createdAt as lastPostAt')
    .first<HashtagSearchAggregate>()

  const postCount = Number(aggregate?.postCount ?? 0)
  if (postCount === 0) {
    await deleteHashtagSearchDocument(database, { hashtag: name })
    return
  }

  const lastPostAt = aggregate?.lastPostAt
    ? getCompatibleTime(aggregate.lastPostAt)
    : null

  await upsertSearchDocument(database, {
    entityType: 'hashtag',
    entityId: name,
    documentText: normalizeSearchText(`${name} #${name}`),
    postCount,
    lastPostAt
  })
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
  for (const row of rows) {
    await indexHashtagSearchDocument(database, { hashtag: row.nameNormalized })
  }

  return {
    indexed: rows.length,
    nextCursor:
      rows.length === limit
        ? normalizeHashtagSearchName(rows[rows.length - 1].nameNormalized)
        : null
  }
}
