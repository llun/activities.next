// The actor's follower, following and status counters, the remote-count sync
// marker, and the NodeInfo usage statistics.
import { sql } from 'kysely'

import type { ActorCounters } from '@/lib/database/domains/actor/rows'
import type {
  GetActorFollowersCountParams,
  GetActorFollowingCountParams,
  HasActorCountersParams,
  SetActorCountersParams
} from '@/lib/database/domains/actor/types'
import type { Db } from '@/lib/database/kysely'
import {
  getCounterValue,
  getCounterValues,
  setCounterValue
} from '@/lib/database/kysely/counter'
import { timestampValue } from '@/lib/database/kysely/dialect'
import { CounterKey } from '@/lib/database/sql/utils/counter'

const ACTIVE_USERS_TTL_SECONDS = 60 * 60
const DAY_MS = 24 * 60 * 60 * 1000

const actorCounterKeys = (actorId: string) => [
  CounterKey.totalFollowers(actorId),
  CounterKey.totalFollowing(actorId),
  CounterKey.totalStatus(actorId)
]

const toActorCounters = (
  values: Record<string, number>,
  actorId: string
): ActorCounters => ({
  followersCount: values[CounterKey.totalFollowers(actorId)] ?? 0,
  followingCount: values[CounterKey.totalFollowing(actorId)] ?? 0,
  statusCount: values[CounterKey.totalStatus(actorId)] ?? 0
})

export const getActorCounters = async (
  db: Db,
  actorId: string
): Promise<ActorCounters> =>
  toActorCounters(
    await getCounterValues(db, actorCounterKeys(actorId)),
    actorId
  )

// One read for every actor's counters, keyed by actor id.
export const getActorCountersByActorId = async (
  db: Db,
  actorIds: string[]
): Promise<Map<string, ActorCounters>> => {
  const values = await getCounterValues(db, actorIds.flatMap(actorCounterKeys))
  return new Map(
    actorIds.map((actorId) => [actorId, toActorCounters(values, actorId)])
  )
}

// Overwrite the actor's counter rows with the collection sizes a remote
// server advertises (followers/following/outbox totalItems). A null or
// undefined value keeps the locally-accumulated counter. Every call also
// stamps the remote-counts-synced marker row, so hasActorCounters reports
// the sync as done even when the remote hides (or fails to serve) a
// collection's total.
export const setActorCounters = async (
  db: Db,
  {
    actorId,
    followersCount,
    followingCount,
    statusCount
  }: SetActorCountersParams
): Promise<void> => {
  const currentTime = new Date()
  const counters: [string, number | null | undefined][] = [
    [CounterKey.totalFollowers(actorId), followersCount],
    [CounterKey.totalFollowing(actorId), followingCount],
    [CounterKey.totalStatus(actorId), statusCount]
  ]
  await Promise.all([
    ...counters
      .filter(
        (counter): counter is [string, number] => typeof counter[1] === 'number'
      )
      .map(([key, value]) => setCounterValue(db, key, value, currentTime)),
    setCounterValue(
      db,
      CounterKey.remoteCountsSyncedAt(actorId),
      Math.floor(currentTime.getTime() / 1000),
      currentTime
    )
  ])
}

// Whether the actor's remote collection counts were ever synced (the
// remote-counts-synced marker row exists). The follower/following/status
// rows themselves can't carry this signal: local accumulation (follows,
// federated statuses) creates them too.
export const hasActorCounters = async (
  db: Db,
  { actorId }: HasActorCountersParams
): Promise<boolean> => {
  const key = CounterKey.remoteCountsSyncedAt(actorId)
  const counters = await getCounterValues(db, [key])
  return key in counters
}

export const getActorFollowingCount = (
  db: Db,
  { actorId }: GetActorFollowingCountParams
): Promise<number> => getCounterValue(db, CounterKey.totalFollowing(actorId))

export const getActorFollowersCount = (
  db: Db,
  { actorId }: GetActorFollowersCountParams
): Promise<number> => getCounterValue(db, CounterKey.totalFollowers(actorId))

// Total users and local posts come from their counters. The monthly and
// half-yearly active users (actors with an account that posted in the last 30
// or 180 days) are cached in counters for an hour and recomputed when stale.
export const getNodeInfoStats = async (db: Db) => {
  const nowSeconds = Math.floor(Date.now() / 1000)

  const totalUsers = await getCounterValue(db, CounterKey.nodeinfoTotalUsers())
  const localPosts = await getCounterValue(db, CounterKey.nodeinfoLocalPosts())
  const computedAt = await getCounterValue(db, CounterKey.nodeinfoComputedAt())
  const isStale =
    computedAt === 0 || nowSeconds - computedAt > ACTIVE_USERS_TTL_SECONDS

  if (!isStale) {
    const activeMonth = await getCounterValue(
      db,
      CounterKey.nodeinfoActiveMonth()
    )
    const activeHalfyear = await getCounterValue(
      db,
      CounterKey.nodeinfoActiveHalfyear()
    )
    return { totalUsers, activeMonth, activeHalfyear, localPosts }
  }

  const now = Date.now()
  const oneMonthAgo = new Date(now - 30 * DAY_MS)
  const sixMonthsAgo = new Date(now - 180 * DAY_MS)

  const activeCounts = await db
    .selectFrom('statuses')
    .innerJoin('actors', 'statuses.actorId', 'actors.id')
    .where('actors.accountId', 'is not', null)
    .where('statuses.createdAt', '>=', timestampValue(sixMonthsAgo))
    .select([
      sql<
        number | string
      >`count(distinct case when ${sql.ref('statuses.createdAt')} >= ${timestampValue(oneMonthAgo)} then ${sql.ref('statuses.actorId')} end)`.as(
        'activeMonth'
      ),
      sql<number | string>`count(distinct ${sql.ref('statuses.actorId')})`.as(
        'activeHalfyear'
      )
    ])
    .executeTakeFirst()

  const activeMonth = Number(activeCounts?.activeMonth ?? 0)
  const activeHalfyear = Number(activeCounts?.activeHalfyear ?? 0)

  const currentTime = new Date(now)
  await setCounterValue(
    db,
    CounterKey.nodeinfoActiveMonth(),
    activeMonth,
    currentTime
  )
  await setCounterValue(
    db,
    CounterKey.nodeinfoActiveHalfyear(),
    activeHalfyear,
    currentTime
  )
  await setCounterValue(
    db,
    CounterKey.nodeinfoComputedAt(),
    nowSeconds,
    currentTime
  )

  return { totalUsers, activeMonth, activeHalfyear, localPosts }
}
