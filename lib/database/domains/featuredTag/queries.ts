import { randomUUID } from 'node:crypto'

import type {
  CountFeaturedTagsParams,
  CreateFeaturedTagParams,
  DeleteFeaturedTagParams,
  FeaturedTag,
  FeaturedTagSuggestion,
  FeaturedTagWithStats,
  GetFeaturedTagByNameParams,
  GetFeaturedTagSuggestionsParams,
  GetFeaturedTagsParams
} from '@/lib/database/domains/featuredTag/types'
import { hashtagsOnPublicStatuses } from '@/lib/database/domains/search/hashtags'
import {
  getHashtagStorageNames,
  normalizeHashtagSearchName
} from '@/lib/database/domains/search/rows'
import type { Db } from '@/lib/database/kysely'
import { normalizedHashtagName } from '@/lib/database/kysely/dialect'
import { toEpochMilliseconds } from '@/lib/database/kysely/normalize'

const COLUMNS = ['id', 'actorId', 'name', 'createdAt'] as const

type Row = {
  id: string
  actorId: string
  name: string
  // Nullable in the schema, but every writer sets it.
  createdAt: number | null
}

const toFeaturedTag = (row: Row): FeaturedTag => ({
  id: row.id,
  actorId: row.actorId,
  name: row.name,
  createdAt: row.createdAt ?? 0
})

const findFeaturedTag = (db: Db, actorId: string, nameNormalized: string) =>
  db
    .selectFrom('featured_tags')
    .select(COLUMNS)
    .where('actorId', '=', actorId)
    .where('nameNormalized', '=', nameNormalized)
    .executeTakeFirst()

// statuses_count and last_status_at of an actor's hashtags, from the actor's
// OWN publicly addressed Notes and Polls only, so the unauthenticated account
// endpoint never counts private posts. Keyed by the bare normalized name.
const getActorHashtagStats = async (
  db: Db,
  actorId: string,
  {
    lookupNames,
    excludeLookupNames = [],
    limit
  }: {
    lookupNames?: string[]
    excludeLookupNames?: string[]
    limit?: number
  } = {}
): Promise<Map<string, FeaturedTagSuggestion>> => {
  if (lookupNames?.length === 0) return new Map()

  let statusHashtags = hashtagsOnPublicStatuses(db)
    .where('statuses.actorId', '=', actorId)
    .select([
      normalizedHashtagName(db, 'tags.nameNormalized').as('name'),
      'statuses.id as statusId',
      'statuses.createdAt as statusCreatedAt'
    ])
    .distinct()
  if (lookupNames) {
    statusHashtags = statusHashtags.where(
      'tags.nameNormalized',
      'in',
      lookupNames
    )
  }
  if (excludeLookupNames.length > 0) {
    statusHashtags = statusHashtags.where(
      'tags.nameNormalized',
      'not in',
      excludeLookupNames
    )
  }

  let query = db
    .selectFrom(statusHashtags.as('hashtag_statuses'))
    .select((eb) => [
      'hashtag_statuses.name',
      eb.fn.count<number>('hashtag_statuses.statusId').as('statusesCount'),
      eb.fn.max('hashtag_statuses.statusCreatedAt').as('lastStatusAt')
    ])
    .groupBy('hashtag_statuses.name')
  // Suggestions rank and cap in the database rather than loading the actor's
  // whole tag history; the featured-tag reads pass no limit.
  if (limit !== undefined) {
    query = query
      .orderBy('statusesCount', 'desc')
      .orderBy('lastStatusAt', 'desc')
      .limit(limit)
  }

  const statsByName = new Map<string, FeaturedTagSuggestion>()
  for (const row of await query.execute()) {
    const name = normalizeHashtagSearchName(row.name)
    if (!name) continue
    // SQLite gives expression columns back as stored.
    statsByName.set(name, {
      name,
      statusesCount: Number(row.statusesCount),
      lastStatusAt: toEpochMilliseconds(row.lastStatusAt)
    })
  }
  return statsByName
}

const withStats = (
  row: Row,
  stats: Map<string, FeaturedTagSuggestion>
): FeaturedTagWithStats => {
  const stat = stats.get(normalizeHashtagSearchName(row.name))
  return {
    ...toFeaturedTag(row),
    statusesCount: stat?.statusesCount ?? 0,
    lastStatusAt: stat?.lastStatusAt ?? null
  }
}

const withOwnStats = async (db: Db, row: Row) =>
  withStats(
    row,
    await getActorHashtagStats(db, row.actorId, {
      lookupNames: getHashtagStorageNames(row.name)
    })
  )

export const getFeaturedTags = async (
  db: Db,
  { actorId }: GetFeaturedTagsParams
): Promise<FeaturedTagWithStats[]> => {
  const rows = await db
    .selectFrom('featured_tags')
    .select(COLUMNS)
    .where('actorId', '=', actorId)
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .execute()
  if (rows.length === 0) return []

  const stats = await getActorHashtagStats(db, actorId, {
    lookupNames: [
      ...new Set(rows.flatMap((row) => getHashtagStorageNames(row.name)))
    ]
  })
  // Mastodon's GET /featured_tags orders by statuses_count desc. createdAt
  // desc (the SQL order above) is the stable tie-breaker for equal counts.
  return rows
    .map((row) => withStats(row, stats))
    .sort((a, b) => b.statusesCount - a.statusesCount)
}

export const countFeaturedTags = async (
  db: Db,
  { actorId }: CountFeaturedTagsParams
): Promise<number> => {
  const row = await db
    .selectFrom('featured_tags')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('actorId', '=', actorId)
    .executeTakeFirst()
  return Number(row?.count ?? 0)
}

export const getFeaturedTagByName = async (
  db: Db,
  { actorId, name }: GetFeaturedTagByNameParams
): Promise<FeaturedTagWithStats | null> => {
  const row = await findFeaturedTag(
    db,
    actorId,
    normalizeHashtagSearchName(name)
  )
  return row ? withOwnStats(db, row) : null
}

// Idempotent: featuring a tag the actor already features (a retry, or a
// concurrent request that won the unique index) returns the existing row.
export const createFeaturedTag = async (
  db: Db,
  { actorId, name }: CreateFeaturedTagParams
): Promise<FeaturedTagWithStats> => {
  const nameNormalized = normalizeHashtagSearchName(name)
  const createdAt = new Date()
  const row = {
    id: randomUUID(),
    actorId,
    name: name.trim().replace(/^#+/, '')
  }
  const { numInsertedOrUpdatedRows } = await db
    .insertInto('featured_tags')
    .values({ ...row, nameNormalized, createdAt })
    .onConflict((oc) => oc.columns(['actorId', 'nameNormalized']).doNothing())
    .executeTakeFirst()
  if (Number(numInsertedOrUpdatedRows) > 0) {
    return withOwnStats(db, { ...row, createdAt: createdAt.getTime() })
  }

  const existing = await findFeaturedTag(db, actorId, nameNormalized)
  if (!existing) throw new Error('Failed to feature tag')
  return withOwnStats(db, existing)
}

export const deleteFeaturedTag = async (
  db: Db,
  { actorId, id }: DeleteFeaturedTagParams
): Promise<FeaturedTag | null> => {
  const existing = await db
    .selectFrom('featured_tags')
    .select(COLUMNS)
    .where('actorId', '=', actorId)
    .where('id', '=', id)
    .executeTakeFirst()
  if (!existing) return null

  await db
    .deleteFrom('featured_tags')
    .where('actorId', '=', actorId)
    .where('id', '=', id)
    .execute()
  return toFeaturedTag(existing)
}

export const getFeaturedTagSuggestions = async (
  db: Db,
  { actorId, limit = 10 }: GetFeaturedTagSuggestionsParams
): Promise<FeaturedTagSuggestion[]> => {
  const featuredRows = await db
    .selectFrom('featured_tags')
    .select('nameNormalized')
    .where('actorId', '=', actorId)
    .execute()
  // The aggregate ranks by statuses_count desc, then last_status_at desc, and
  // caps at the limit.
  const stats = await getActorHashtagStats(db, actorId, {
    excludeLookupNames: featuredRows.flatMap((row) =>
      getHashtagStorageNames(row.nameNormalized)
    ),
    limit
  })
  return [...stats.values()]
}

export const featuredTagQueries = {
  getFeaturedTags,
  countFeaturedTags,
  getFeaturedTagByName,
  createFeaturedTag,
  deleteFeaturedTag,
  getFeaturedTagSuggestions
}
