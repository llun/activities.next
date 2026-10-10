import { sql } from 'kysely'

import { hashtagsOnPublicStatuses } from '@/lib/database/domains/search/hashtags'
import {
  getHashtagStorageNames,
  normalizeHashtagSearchName
} from '@/lib/database/domains/search/rows'
import type {
  GetTagDailyHistoryParams,
  GetTrendingStatusCandidateIdsParams,
  GetTrendingTagsParams,
  TagDailyHistoryPoint,
  TrendingTag
} from '@/lib/database/domains/trends/types'
import type { Db } from '@/lib/database/kysely'
import {
  normalizedHashtagName,
  timestampValue
} from '@/lib/database/kysely/dialect'
import { isLocalActor } from '@/lib/database/kysely/visibility/localActor'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

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

// Shared start of the trends window, used by both the tag and status queries
// so the two endpoints always agree on which rows are "in window". It starts at
// the oldest rendered UTC day bucket (today minus `days - 1` whole days) rather
// than a rolling `days × 24h` span, so the tag ranking counts exactly the rows
// the route's zero-filled `days` calendar-day history can show.
const getTrendsWindowStart = (days: number): Date =>
  new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS - (days - 1) * DAY_MS)

// Distinct (normalized tag name, status, author) rows for the hashtags of
// public Notes and Polls created in the window: the rows hashtag search and
// featured tags count, instance-wide.
const getWindowedPublicTagUsage = (db: Db, days: number) =>
  hashtagsOnPublicStatuses(db)
    .where(
      'statuses.createdAt',
      '>=',
      timestampValue(getTrendsWindowStart(days))
    )
    .select([
      normalizedHashtagName(db, 'tags.nameNormalized').as('name'),
      'statuses.id as statusId',
      'statuses.actorId as statusActorId'
    ])
    .distinct()

export const getTrendingTags = async (
  db: Db,
  { days, limit, offset }: GetTrendingTagsParams
): Promise<TrendingTag[]> => {
  const rows = await db
    .selectFrom(getWindowedPublicTagUsage(db, days).as('tag_usage'))
    .select((eb) => [
      'tag_usage.name',
      eb.fn.count<number>('tag_usage.statusId').distinct().as('uses'),
      eb.fn.count<number>('tag_usage.statusActorId').distinct().as('accounts')
    ])
    .groupBy('tag_usage.name')
    .orderBy('uses', 'desc')
    .orderBy('tag_usage.name', 'asc')
    .limit(limit)
    .offset(offset)
    .execute()

  // SQLite gives expression columns back as stored.
  return rows.map((row) => ({
    name: row.name,
    uses: Number(row.uses),
    accounts: Number(row.accounts)
  }))
}

// Mirrors the LOCAL_PUBLIC timeline selection (top-level public statuses by
// local actors), restricted to the trends window and to content types that
// carry their own counters: Announce boosts are skipped, the boosted original
// ranks through its own row. Public means a `to` recipient of the public
// collection (the strictly public, non-unlisted addressing the public timeline
// uses), as a semi-join so no row needs `distinct`.
export const getTrendingStatusCandidateIds = async (
  db: Db,
  { days }: GetTrendingStatusCandidateIdsParams
): Promise<string[]> => {
  const rows = await db
    .selectFrom('statuses')
    .innerJoin('actors', 'statuses.actorId', 'actors.id')
    .select('statuses.id')
    .where(isLocalActor)
    .where('statuses.reply', '=', '')
    .where('statuses.type', 'in', [StatusType.enum.Note, StatusType.enum.Poll])
    .where(
      'statuses.createdAt',
      '>=',
      timestampValue(getTrendsWindowStart(days))
    )
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('recipients')
          .select(sql.lit(1).as('one'))
          .whereRef('recipients.statusId', '=', 'statuses.id')
          .where('recipients.type', '=', 'to')
          .where('recipients.actorId', '=', ACTIVITY_STREAM_PUBLIC)
      )
    )
    .orderBy('statuses.createdAt', 'desc')
    .orderBy('statuses.id', 'desc')
    .limit(TRENDING_STATUS_CANDIDATE_LIMIT)
    .execute()
  return rows.map((row) => row.id)
}

export const getTagDailyHistory = async (
  db: Db,
  { names, days }: GetTagDailyHistoryParams
): Promise<Map<string, TagDailyHistoryPoint[]>> => {
  // Every requested (normalizable) name gets an entry — possibly an empty
  // list — so the route can zero-fill without checking key presence.
  const history = new Map<string, TagDailyHistoryPoint[]>()
  for (const name of names) {
    const bare = normalizeHashtagSearchName(name)
    if (bare) history.set(bare, [])
  }
  if (history.size === 0) return history

  const rows = await getWindowedPublicTagUsage(db, days)
    .select('statuses.createdAt as statusCreatedAt')
    .where(
      'tags.nameNormalized',
      'in',
      [...history.keys()].flatMap(getHashtagStorageNames)
    )
    .execute()

  // Bucket per UTC day in JS: portable across dialects (no SQL date
  // functions), and the windowed row volume stays small on a personal server.
  // Distinct sets guard against counting a status twice when it matched
  // through both stored tag-name forms.
  type BucketCounter = { statusIds: Set<string>; actorIds: Set<string> }
  const bucketsByName = new Map<string, Map<number, BucketCounter>>()
  for (const row of rows) {
    const bare = normalizeHashtagSearchName(row.name)
    if (!history.has(bare)) continue

    const dayBucketMs = Math.floor((row.statusCreatedAt ?? 0) / DAY_MS) * DAY_MS
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
    counter.actorIds.add(String(row.statusActorId))
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

export const trendsQueries = {
  getTrendingTags,
  getTrendingStatusCandidateIds,
  getTagDailyHistory
}
