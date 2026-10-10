import { sql } from 'kysely'

import { getConfig } from '@/lib/config'
import {
  deleteSearchDocument,
  searchDocuments
} from '@/lib/database/domains/search/documents'
import {
  getHashtagStorageNames,
  getSearchDocumentId,
  normalizeHashtagSearchName,
  normalizeSearchText
} from '@/lib/database/domains/search/rows'
import type {
  ReindexSearchDocumentsParams,
  ReindexSearchDocumentsResult,
  SearchHashtag,
  SearchHashtagsParams
} from '@/lib/database/domains/search/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import { forUpdate, normalizedHashtagName } from '@/lib/database/kysely/dialect'
import {
  getWhereInBatchSize,
  insertInChunks,
  selectInChunks
} from '@/lib/database/kysely/inList'
import { toEpochMilliseconds } from '@/lib/database/kysely/normalize'
import { PUBLIC_ACTIVITY_RECIPIENTS } from '@/lib/database/kysely/visibility/potentiallyReadable'
import { chunkArray } from '@/lib/database/sql/utils/knex'
import { StatusType } from '@/lib/types/domain/status'

type HashtagSearchAggregate = {
  name: string
  postCount: number
  lastPostAt: number | null
}

// Values the aggregate query binds besides its tag names: SQLite's `#` for
// ltrim(), the public recipients, the two status types and the tag type.
const HASHTAG_AGGREGATE_FIXED_BINDINGS =
  1 + PUBLIC_ACTIVITY_RECIPIENTS.length + 2 + 1
const HASHTAG_STORAGE_NAMES_PER_SEARCH_NAME = 2
const STALE_HASHTAG_SEARCH_CLEANUP_BATCH_SIZE = 100

const getTagUrl = (name: string) => {
  const host = getConfig().host
  const baseURL = host.includes('://') ? host : `https://${host}`
  return `${baseURL}/tags/${encodeURIComponent(name)}`
}

// The hashtag rows of publicly addressed Notes and Polls, joined to their
// status. Hashtag search, featured tags and trends count the same rows.
export const hashtagsOnPublicStatuses = (db: Db) =>
  db
    .selectFrom('tags')
    .innerJoin('statuses', 'statuses.id', 'tags.statusId')
    .where('tags.type', '=', 'hashtag')
    .where('statuses.type', 'in', [StatusType.enum.Note, StatusType.enum.Poll])
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('recipients')
          .select(sql.lit(1).as('one'))
          .whereRef('recipients.statusId', '=', 'statuses.id')
          .where('recipients.actorId', 'in', PUBLIC_ACTIVITY_RECIPIENTS)
      )
    )

const getHashtagSearchAggregates = async (db: Db, names: string[]) => {
  const requestedNames = new Set(names)
  const batchSize = Math.max(
    1,
    Math.floor(
      getWhereInBatchSize(db, HASHTAG_AGGREGATE_FIXED_BINDINGS) /
        HASHTAG_STORAGE_NAMES_PER_SEARCH_NAME
    )
  )
  const aggregateByName = new Map<string, HashtagSearchAggregate>()

  for (const nameChunk of chunkArray(names, batchSize)) {
    const lookupNames = [...new Set(nameChunk.flatMap(getHashtagStorageNames))]
    const rows = await db
      .selectFrom(
        hashtagsOnPublicStatuses(db)
          .where('tags.nameNormalized', 'in', lookupNames)
          .select([
            normalizedHashtagName(db, 'tags.nameNormalized').as('name'),
            'statuses.id as statusId',
            'statuses.createdAt as statusCreatedAt'
          ])
          .distinct()
          .as('hashtag_statuses')
      )
      .select((eb) => [
        'hashtag_statuses.name',
        eb.fn.count<number>('hashtag_statuses.statusId').as('postCount'),
        eb.fn.max('hashtag_statuses.statusCreatedAt').as('lastPostAt')
      ])
      .groupBy('hashtag_statuses.name')
      .execute()

    for (const row of rows) {
      const name = normalizeHashtagSearchName(row.name)
      if (!requestedNames.has(name)) continue

      // A name can come back from two chunks (`# foo` folds to `foo`); both
      // carry the same counts, so the later one replaces the earlier.
      // SQLite gives expression columns back as stored.
      aggregateByName.set(name, {
        name,
        postCount: Number(row.postCount),
        lastPostAt: toEpochMilliseconds(row.lastPostAt)
      })
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
}) => ({
  id: getSearchDocumentId({ entityType: 'hashtag', entityId: name }),
  entityType: 'hashtag',
  entityId: name,
  documentText: normalizeSearchText(`${name} #${name}`),
  actorId: null,
  visibility: null,
  entityCreatedAt: null,
  discoverable: null,
  postCount: aggregate ? aggregate.postCount : null,
  lastPostAt:
    aggregate?.lastPostAt !== null && aggregate?.lastPostAt !== undefined
      ? new Date(aggregate.lastPostAt)
      : null,
  createdAt: currentTime,
  updatedAt: currentTime
})

// search_documents has a covering (entityType, entityId) index: walk it in
// bounded pages, with one batched tags lookup per page.
const deleteStaleHashtagSearchDocuments = async (db: Db) => {
  let afterEntityId: string | null = null

  while (true) {
    let query = db
      .selectFrom('search_documents')
      .select('entityId')
      .where('entityType', '=', 'hashtag')
    if (afterEntityId !== null) {
      query = query.where('entityId', '>', afterEntityId)
    }
    const rows = await query
      .orderBy('entityId', 'asc')
      .limit(STALE_HASHTAG_SEARCH_CLEANUP_BATCH_SIZE)
      .execute()
    if (rows.length === 0) return

    afterEntityId = rows[rows.length - 1].entityId
    const names = rows.map((row) => row.entityId)
    const lookupNames = [...new Set(names.flatMap(getHashtagStorageNames))]
    const liveNames = new Set<string>()

    if (lookupNames.length > 0) {
      const tagRows = await db
        .selectFrom('tags')
        .select('tags.nameNormalized as normalizedName')
        .distinct()
        .where('type', '=', 'hashtag')
        .where('nameNormalized', 'is not', null)
        .where('nameNormalized', 'in', lookupNames)
        .execute()
      for (const { normalizedName } of tagRows) {
        const name = normalizeHashtagSearchName(normalizedName ?? '')
        if (name.length > 0) liveNames.add(name)
      }
    }

    const staleNames = names.filter((name) => !liveNames.has(name))
    if (staleNames.length > 0) {
      await db
        .deleteFrom('search_documents')
        .where('entityType', '=', 'hashtag')
        .where('entityId', 'in', staleNames)
        .execute()
    }
  }
}

const reindexHashtagSearchDocuments = async (db: Db, hashtags: string[]) => {
  const names = [
    ...new Set(
      hashtags.map(normalizeHashtagSearchName).filter((name) => name.length > 0)
    )
  ]
  if (names.length === 0) return

  await inTransaction(db, async (trx) => {
    const currentTime = new Date()
    // A placeholder row per name gives the lock below a row to take.
    await insertInChunks(
      trx,
      names.map((name) => getHashtagSearchDocumentRow({ currentTime, name })),
      (chunk) =>
        trx
          .insertInto('search_documents')
          .values(chunk)
          .onConflict((oc) => oc.column('id').doNothing())
          .execute()
    )
    await selectInChunks(
      trx,
      names,
      (chunk) =>
        forUpdate(
          trx,
          trx
            .selectFrom('search_documents')
            .select('id')
            .where('entityType', '=', 'hashtag')
            .where('entityId', 'in', chunk)
        ).execute(),
      1
    )

    const aggregates = await getHashtagSearchAggregates(trx, names)
    const countedNames = new Set(aggregates.map((aggregate) => aggregate.name))
    const namesToDelete = names.filter((name) => !countedNames.has(name))
    for (const nameChunk of chunkArray(
      namesToDelete,
      getWhereInBatchSize(trx, 1)
    )) {
      await trx
        .deleteFrom('search_documents')
        .where('entityType', '=', 'hashtag')
        .where('entityId', 'in', nameChunk)
        .execute()
    }

    await insertInChunks(
      trx,
      aggregates.map((aggregate) =>
        getHashtagSearchDocumentRow({
          aggregate,
          currentTime,
          name: aggregate.name
        })
      ),
      (chunk) =>
        trx
          .insertInto('search_documents')
          .values(chunk)
          .onConflict((oc) =>
            oc.column('id').doUpdateSet((eb) => ({
              documentText: eb.ref('excluded.documentText'),
              postCount: eb.ref('excluded.postCount'),
              lastPostAt: eb.ref('excluded.lastPostAt'),
              updatedAt: eb.ref('excluded.updatedAt')
            }))
          )
          .execute()
    )
  })
}

export const indexHashtagSearchDocument = (
  db: Db,
  { hashtag }: { hashtag: string }
): Promise<void> => reindexHashtagSearchDocuments(db, [hashtag])

export const indexHashtagSearchDocuments = (
  db: Db,
  { hashtags }: { hashtags: string[] }
): Promise<void> => reindexHashtagSearchDocuments(db, hashtags)

export const deleteHashtagSearchDocument = (
  db: Db,
  { hashtag }: { hashtag: string }
): Promise<void> =>
  deleteSearchDocument(db, {
    entityType: 'hashtag',
    entityId: normalizeHashtagSearchName(hashtag)
  })

export const searchHashtags = async (
  db: Db,
  { q, limit, offset = 0 }: SearchHashtagsParams
): Promise<SearchHashtag[]> => {
  const documents = await searchDocuments(db, {
    entityType: 'hashtag',
    q,
    limit,
    offset
  })
  return documents.map((document) => ({
    name: document.entityId,
    url: getTagUrl(document.entityId),
    // Trend history is not indexed yet; keep the Mastodon-compatible field empty.
    history: [],
    following: false,
    postCount: document.postCount ?? 0,
    lastPostAt: document.lastPostAt
  }))
}

/**
 * Reindex one cursor page of hashtag search documents.
 *
 * Stale hashtag document cleanup is tied to a full reindex run that starts
 * with a null cursor. Resumed or sharded callers that pass a non-null afterId
 * skip that cleanup pass to avoid repeating the bounded table scan per page.
 */
export const reindexSearchHashtags = async (
  db: Db,
  { afterId = null, limit = 500 }: ReindexSearchDocumentsParams = {}
): Promise<ReindexSearchDocumentsResult> => {
  if (afterId === null) await deleteStaleHashtagSearchDocuments(db)

  let query = db
    .selectFrom('tags')
    .select('tags.nameNormalized as normalizedName')
    .distinct()
    .where('type', '=', 'hashtag')
    .where('nameNormalized', 'is not', null)
  if (afterId) query = query.where('tags.nameNormalized', '>', afterId)
  const rows = await query
    .orderBy('tags.nameNormalized', 'asc')
    .limit(limit)
    .$narrowType<{ normalizedName: string }>()
    .execute()

  // Normalized here and again on indexing, so `# foo` indexes as `foo`.
  await reindexHashtagSearchDocuments(
    db,
    rows.map((row) => normalizeHashtagSearchName(row.normalizedName))
  )

  return {
    indexed: rows.length,
    nextCursor:
      rows.length === limit ? rows[rows.length - 1].normalizedName : null
  }
}
