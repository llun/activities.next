import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { normalizeHashtagSearchName } from '@/lib/database/sql/search/hashtag'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { isUniqueConstraintError } from '@/lib/database/sql/utils/isUniqueConstraintError'
import { KnexConnection, isSQLiteClient } from '@/lib/database/sql/utils/knex'
import {
  CountFeaturedTagsParams,
  CreateFeaturedTagParams,
  DeleteFeaturedTagParams,
  FeaturedTag,
  FeaturedTagDatabase,
  FeaturedTagSuggestion,
  FeaturedTagWithStats,
  GetFeaturedTagByNameParams,
  GetFeaturedTagParams,
  GetFeaturedTagSuggestionsParams,
  GetFeaturedTagsParams
} from '@/lib/types/database/operations'
import { StatusType } from '@/lib/types/domain/status'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'

const PUBLIC_ACTIVITY_RECIPIENTS = [
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
]

type SQLFeaturedTag = {
  id: string
  actorId: string
  name: string
  nameNormalized: string
  createdAt: number | Date | string
}

type StatsAggregateRow = {
  name: string
  statusesCount: number | string
  lastStatusAt: number | Date | string | null
}

// The stored `tags.nameNormalized` for hashtags can carry a leading `#`, so we
// strip it in SQL before grouping/matching. Mirrors the hashtag search layer so
// featured-tag aggregation matches the same rows hashtag search counts.
const getNormalizedHashtagNameSQL = (database: KnexConnection) => {
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

// Both stored forms exist in `tags.nameNormalized` (`bare` and `#bare`); look up
// both, exactly like the status/search hashtag layer.
const getHashtagLookupNames = (name: string) => {
  const bare = normalizeHashtagSearchName(name)
  return bare ? [bare, `#${bare}`] : []
}

const toFeaturedTag = (row: SQLFeaturedTag): FeaturedTag => ({
  id: row.id,
  actorId: row.actorId,
  name: row.name,
  createdAt: getCompatibleTime(row.createdAt)
})

// Aggregates statuses_count / last_status_at for an actor's hashtags from the
// actor's OWN publicly-addressed Note/Poll statuses. Restricting to public
// statuses avoids leaking private post counts on the unauthenticated account
// endpoint. Returns a map keyed by the bare (no `#`) normalized name.
const getActorHashtagStats = async (
  database: KnexConnection,
  actorId: string,
  {
    lookupNames,
    excludeLookupNames,
    limit
  }: {
    lookupNames?: string[]
    excludeLookupNames?: string[]
    limit?: number
  } = {}
): Promise<Map<string, FeaturedTagSuggestion>> => {
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
    .where('statuses.actorId', actorId)
    .whereIn('statuses.type', [StatusType.enum.Note, StatusType.enum.Poll])
    .whereExists((builder) => {
      builder
        .select(database.raw('1'))
        .from('recipients')
        .whereRaw('?? = ??', ['recipients.statusId', 'statuses.id'])
        .whereIn('recipients.actorId', PUBLIC_ACTIVITY_RECIPIENTS)
    })

  if (lookupNames) {
    if (lookupNames.length === 0) return new Map()
    distinctStatusHashtags.whereIn('tags.nameNormalized', lookupNames)
  }
  if (excludeLookupNames && excludeLookupNames.length > 0) {
    distinctStatusHashtags.whereNotIn('tags.nameNormalized', excludeLookupNames)
  }

  const query = database
    .from(distinctStatusHashtags.as('hashtag_statuses'))
    .select({ name: 'hashtag_statuses.name' })
    .count({ statusesCount: 'hashtag_statuses.statusId' })
    .max({ lastStatusAt: 'hashtag_statuses.statusCreatedAt' })
    .groupBy('hashtag_statuses.name')

  // For the suggestions path, push ordering + limiting to the database so we
  // never load the actor's entire tag history into memory. The list/get paths
  // pass no limit and keep their own (tiny, featured-only) in-memory handling.
  if (limit !== undefined) {
    query
      .orderBy('statusesCount', 'desc')
      .orderBy('lastStatusAt', 'desc')
      .limit(limit)
  }

  const rows = (await query) as StatsAggregateRow[]

  const statsByName = new Map<string, FeaturedTagSuggestion>()
  for (const row of rows) {
    const bare = normalizeHashtagSearchName(row.name)
    if (!bare) continue
    statsByName.set(bare, {
      name: bare,
      statusesCount: Number(row.statusesCount ?? 0),
      lastStatusAt:
        row.lastStatusAt !== null && row.lastStatusAt !== undefined
          ? getCompatibleTime(row.lastStatusAt)
          : null
    })
  }
  return statsByName
}

const withStats = (
  row: SQLFeaturedTag,
  stats: Map<string, FeaturedTagSuggestion>
): FeaturedTagWithStats => {
  const bare = normalizeHashtagSearchName(row.name)
  const stat = stats.get(bare)
  return {
    ...toFeaturedTag(row),
    statusesCount: stat?.statusesCount ?? 0,
    lastStatusAt: stat?.lastStatusAt ?? null
  }
}

export const FeaturedTagSQLDatabaseMixin = (
  database: Knex
): FeaturedTagDatabase => ({
  async getFeaturedTags({ actorId }: GetFeaturedTagsParams) {
    const rows = await database<SQLFeaturedTag>('featured_tags')
      .where('actorId', actorId)
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
    if (rows.length === 0) return []

    const lookupNames = [
      ...new Set(rows.flatMap((row) => getHashtagLookupNames(row.name)))
    ]
    const stats = await getActorHashtagStats(database, actorId, { lookupNames })

    // Mastodon's GET /featured_tags orders by statuses_count desc. createdAt
    // desc (the SQL order above) is the stable tie-breaker for equal counts.
    return rows
      .map((row) => withStats(row, stats))
      .sort((a, b) => b.statusesCount - a.statusesCount)
  },

  async countFeaturedTags({ actorId }: CountFeaturedTagsParams) {
    const row = await database('featured_tags')
      .where('actorId', actorId)
      .count<{ count: number | string }>({ count: '*' })
      .first()
    return Number(row?.count ?? 0)
  },

  async getFeaturedTag({ actorId, id }: GetFeaturedTagParams) {
    const row = await database<SQLFeaturedTag>('featured_tags')
      .where({ actorId, id })
      .first()
    if (!row) return null
    const stats = await getActorHashtagStats(database, actorId, {
      lookupNames: getHashtagLookupNames(row.name)
    })
    return withStats(row, stats)
  },

  async getFeaturedTagByName({ actorId, name }: GetFeaturedTagByNameParams) {
    const nameNormalized = normalizeHashtagSearchName(name)
    const row = await database<SQLFeaturedTag>('featured_tags')
      .where({ actorId, nameNormalized })
      .first()
    if (!row) return null
    const stats = await getActorHashtagStats(database, actorId, {
      lookupNames: getHashtagLookupNames(row.name)
    })
    return withStats(row, stats)
  },

  async createFeaturedTag({ actorId, name }: CreateFeaturedTagParams) {
    const displayName = name.trim().replace(/^#+/, '')
    const nameNormalized = normalizeHashtagSearchName(name)
    const row = {
      id: randomUUID(),
      actorId,
      name: displayName,
      nameNormalized,
      createdAt: new Date()
    }
    try {
      await database('featured_tags').insert(row)
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      // Idempotent by contract: a concurrent insert that loses the unique-index
      // race resolves to the same existing row (the route also short-circuits on
      // an existing tag before reaching here), so featuring is safe to retry.
      const existing = await database<SQLFeaturedTag>('featured_tags')
        .where({ actorId, nameNormalized })
        .first()
      if (!existing) throw error
      const stats = await getActorHashtagStats(database, actorId, {
        lookupNames: getHashtagLookupNames(existing.name)
      })
      return withStats(existing, stats)
    }
    const stats = await getActorHashtagStats(database, actorId, {
      lookupNames: getHashtagLookupNames(displayName)
    })
    return withStats(row as unknown as SQLFeaturedTag, stats)
  },

  async deleteFeaturedTag({ actorId, id }: DeleteFeaturedTagParams) {
    const existing = await database<SQLFeaturedTag>('featured_tags')
      .where({ actorId, id })
      .first()
    if (!existing) return null
    await database('featured_tags').where({ actorId, id }).delete()
    return toFeaturedTag(existing)
  },

  async getFeaturedTagSuggestions({
    actorId,
    limit = 10
  }: GetFeaturedTagSuggestionsParams) {
    const featuredRows = await database<SQLFeaturedTag>('featured_tags')
      .where('actorId', actorId)
      .select('nameNormalized')
    // featured_tags.nameNormalized is stored bare; the tags table can carry a
    // leading `#`, so exclude both stored forms.
    const excludeLookupNames = featuredRows.flatMap((row) =>
      getHashtagLookupNames(row.nameNormalized)
    )

    // The aggregate query already orders by statuses_count desc (then
    // last_status_at desc) and limits, so the rows arrive ranked and capped.
    const stats = await getActorHashtagStats(database, actorId, {
      excludeLookupNames,
      limit
    })
    return [...stats.values()]
  }
})
