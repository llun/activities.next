import { Knex } from 'knex'

import {
  getNormalizedHashtagNameSQL,
  normalizeHashtagSearchName
} from '@/lib/database/sql/search/hashtag'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  GetTagDailyHistoryParams,
  GetTrendingStatusCandidateIdsParams,
  GetTrendingTagsParams,
  TagDailyHistoryPoint,
  TrendingTag,
  TrendsDatabase
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

const DAY_MS = 86_400_000

// Upper bound on the trending-status candidate set. The window already bounds
// the volume on a personal-scale instance, but a busy or federated instance
// could accumulate far more public statuses in seven days; without a cap the
// ids would be loaded into memory and fanned out through getStatusesByIds'
// single `whereIn` (risking the backend's bind-variable limit). 1000 newest
// candidates is well above what a personal server produces in the window yet
// safely bounds memory and the query — the service still ranks and slices to
// Mastodon's max of 20 from within them.
const TRENDING_STATUS_CANDIDATE_LIMIT = 1000

type SQLTrendingTagRow = {
  name: string
  // count() comes back as a string on Postgres but a number on SQLite.
  uses: number | string
  accounts: number | string
}

type SQLTagUsageRow = {
  name: string
  statusId: string
  statusActorId: string
  // statuses.createdAt is written as a Date binding: better-sqlite3 stores it
  // as epoch milliseconds, Postgres as timestamptz — normalize on read.
  statusCreatedAt: number | Date | string
}

// Both stored forms exist in `tags.nameNormalized` (`bare` and `#bare`); look
// up both, exactly like the status/search hashtag layer.
const getHashtagLookupNames = (name: string) => {
  const bare = normalizeHashtagSearchName(name)
  return bare ? [bare, `#${bare}`] : []
}

// Shared start of the trends window, used by both the tag and status queries
// so the two endpoints always agree on which rows are "in window". It starts at
// the oldest rendered UTC day bucket (today minus `days - 1` whole days) rather
// than a rolling `days × 24h` span, so the tag ranking counts exactly the rows
// the route's zero-filled `days` calendar-day history can show. Binding a Date
// keeps the predicate portable (epoch milliseconds on SQLite, timestamptz on
// Postgres) — the same pattern as the nodeinfo active-user window.
const getTrendsWindowStart = (days: number): Date =>
  new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS - (days - 1) * DAY_MS)

// Distinct (normalized tag name, statusId, statusActorId[, statusCreatedAt])
// rows for hashtags on publicly-addressed Note/Poll statuses created within
// the last `days` days. Mirrors the featured-tag / hashtag-search aggregation
// (same name normalization and public-recipients EXISTS restriction) but with
// no per-actor filter — trends are instance-wide.
const getWindowedPublicTagUsage = (
  database: Knex,
  {
    days,
    includeCreatedAt = false
  }: { days: number; includeCreatedAt?: boolean }
) => {
  const normalizedNameSQL = getNormalizedHashtagNameSQL(database)
  const since = getTrendsWindowStart(days)
  return database('tags')
    .distinct(
      database.raw(`${normalizedNameSQL.sql} as ??`, [
        ...normalizedNameSQL.bindings,
        'name'
      ]),
      database.raw('?? as ??', ['statuses.id', 'statusId']),
      database.raw('?? as ??', ['statuses.actorId', 'statusActorId']),
      ...(includeCreatedAt
        ? [database.raw('?? as ??', ['statuses.createdAt', 'statusCreatedAt'])]
        : [])
    )
    .innerJoin('statuses', 'statuses.id', 'tags.statusId')
    .where('tags.type', 'hashtag')
    .whereIn('statuses.type', [StatusType.enum.Note, StatusType.enum.Poll])
    .where('statuses.createdAt', '>=', since)
    .whereExists((builder) => {
      builder
        .select(database.raw('1'))
        .from('recipients')
        .whereRaw('?? = ??', ['recipients.statusId', 'statuses.id'])
        .whereIn('recipients.actorId', PUBLIC_ACTIVITY_RECIPIENTS)
    })
}

export const TrendsSQLDatabaseMixin = (database: Knex): TrendsDatabase => ({
  async getTrendingTags({ days, limit, offset }: GetTrendingTagsParams) {
    const usage = getWindowedPublicTagUsage(database, { days })
    const rows = (await database
      .from(usage.as('tag_usage'))
      .select({ name: 'tag_usage.name' })
      .countDistinct({ uses: 'tag_usage.statusId' })
      .countDistinct({ accounts: 'tag_usage.statusActorId' })
      .groupBy('tag_usage.name')
      .orderBy([
        { column: 'uses', order: 'desc' },
        { column: 'tag_usage.name', order: 'asc' }
      ])
      .offset(offset)
      .limit(limit)) as SQLTrendingTagRow[]

    return rows.map(
      (row): TrendingTag => ({
        name: row.name,
        uses: Number(row.uses),
        accounts: Number(row.accounts)
      })
    )
  },

  async getTrendingStatusCandidateIds({
    days
  }: GetTrendingStatusCandidateIdsParams) {
    // Mirror the LOCAL_PUBLIC timeline selection (top-level public statuses by
    // local actors), but restricted to the trends window and to content types
    // that carry their own counters — Announce boosts are skipped, the boosted
    // original ranks through its own row. Public is gated with a `whereExists`
    // on the `to` recipient pointing at the public collection (the strictly
    // public, non-unlisted addressing the public timeline uses): the candidate
    // set needs no per-status async access check before ranking, and the
    // semi-join avoids the row duplication a direct join would need `distinct`
    // to undo. Shares getTrendsWindowStart so the window matches trending tags.
    const since = getTrendsWindowStart(days)
    const rows = (await database('statuses')
      .innerJoin('actors', 'statuses.actorId', 'actors.id')
      .whereNotNull('actors.privateKey')
      .where('statuses.reply', '')
      .whereIn('statuses.type', [StatusType.enum.Note, StatusType.enum.Poll])
      .where('statuses.createdAt', '>=', since)
      .whereExists((builder) => {
        builder
          .select(database.raw('1'))
          .from('recipients')
          .whereRaw('?? = ??', ['recipients.statusId', 'statuses.id'])
          .where('recipients.type', 'to')
          .where('recipients.actorId', ACTIVITY_STREAM_PUBLIC)
      })
      .select('statuses.id as id')
      .orderBy('statuses.createdAt', 'desc')
      .orderBy('statuses.id', 'desc')
      .limit(TRENDING_STATUS_CANDIDATE_LIMIT)) as { id: string }[]
    return rows.map((row) => row.id)
  },

  async getTagDailyHistory({ names, days }: GetTagDailyHistoryParams) {
    // Every requested (normalizable) name gets an entry — possibly an empty
    // list — so the route can zero-fill without checking key presence.
    const history = new Map<string, TagDailyHistoryPoint[]>()
    for (const name of names) {
      const bare = normalizeHashtagSearchName(name)
      if (bare) history.set(bare, [])
    }
    if (history.size === 0) return history

    const lookupNames = [...history.keys()].flatMap(getHashtagLookupNames)
    const rows = (await getWindowedPublicTagUsage(database, {
      days,
      includeCreatedAt: true
    }).whereIn('tags.nameNormalized', lookupNames)) as SQLTagUsageRow[]

    // Bucket per UTC day in JS — portable across dialects (no SQL date
    // functions) and the windowed row volume stays small on a personal
    // server. Distinct sets guard against double-counting a status that
    // matched through both stored tag-name forms.
    type BucketCounter = { statusIds: Set<string>; actorIds: Set<string> }
    const bucketsByName = new Map<string, Map<number, BucketCounter>>()
    for (const row of rows) {
      const bare = normalizeHashtagSearchName(row.name)
      if (!history.has(bare)) continue

      const dayBucketMs =
        Math.floor(getCompatibleTime(row.statusCreatedAt) / DAY_MS) * DAY_MS
      let buckets = bucketsByName.get(bare)
      if (!buckets) {
        buckets = new Map()
        bucketsByName.set(bare, buckets)
      }
      let counter = buckets.get(dayBucketMs)
      if (!counter) {
        counter = { statusIds: new Set(), actorIds: new Set() }
        buckets.set(dayBucketMs, counter)
      }
      counter.statusIds.add(row.statusId)
      counter.actorIds.add(row.statusActorId)
    }

    for (const [bare, buckets] of bucketsByName) {
      history.set(
        bare,
        [...buckets.entries()]
          .sort(([firstDay], [secondDay]) => secondDay - firstDay)
          .map(([dayBucketMs, counter]) => ({
            dayBucketMs,
            uses: counter.statusIds.size,
            accounts: counter.actorIds.size
          }))
      )
    }
    return history
  }
})
