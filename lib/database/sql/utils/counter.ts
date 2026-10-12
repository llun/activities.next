// The `counters` row keys, and how a stored value reads back as a count. The
// reads and writes are in lib/database/kysely/counter.ts.

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER

const clampCounterValue = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value > MAX_SAFE_INTEGER) return MAX_SAFE_INTEGER
  return Math.floor(value)
}

export const parseCounterValue = (
  value: number | string | bigint | null | undefined
): number => {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return clampCounterValue(value)
  if (typeof value === 'bigint') return clampCounterValue(Number(value))

  const parsed = Number.parseInt(value, 10)
  return clampCounterValue(Number.isNaN(parsed) ? 0 : parsed)
}

export const CounterKey = {
  totalStatus: (actorId: string) => `total-status:${actorId}`,
  totalFollowers: (actorId: string) => `total-followers:${actorId}`,
  totalFollowing: (actorId: string) => `total-following:${actorId}`,
  // Marker row (value = epoch seconds) recording that the actor's
  // remote-advertised collection totals were synced at least once. Row
  // existence is the signal; the follower/following/status rows above can't
  // carry it because local accumulation (follows, federated statuses) also
  // creates them.
  remoteCountsSyncedAt: (actorId: string) => `remote-counts-synced:${actorId}`,
  totalBlocking: (actorId: string) => `total-blocking:${actorId}`,
  totalBlockedBy: (actorId: string) => `total-blocked-by:${actorId}`,
  totalLike: (statusId: string) => `total-like:${statusId}`,
  totalReblog: (statusId: string) => `total-reblog:${statusId}`,
  totalReply: (statusId: string) => `total-reply:${statusId}`,
  mediaUsage: (accountId: string) => `media-usage:${accountId}`,
  totalMedia: (accountId: string) => `total-media:${accountId}`,
  fitnessUsage: (accountId: string) => `fitness-usage:${accountId}`,
  totalFitness: (accountId: string) => `total-fitness:${accountId}`,
  nodeinfoTotalUsers: () => 'nodeinfo:total-users',
  nodeinfoLocalPosts: () => 'nodeinfo:local-posts',
  nodeinfoActiveMonth: () => 'nodeinfo:active-month',
  nodeinfoActiveHalfyear: () => 'nodeinfo:active-halfyear',
  nodeinfoComputedAt: () => 'nodeinfo:computed-at',
  serviceTotalAccounts: () => 'servicestat:total-accounts',
  serviceTotalActors: () => 'servicestat:total-actors',
  serviceTotalStatuses: () => 'servicestat:total-statuses',
  totalHashtag: (hashtag: string) => `total-hashtag:${hashtag.toLowerCase()}`,
  bucketKey: (counterType: string, hour: string) =>
    `bucket:${counterType}:${hour}`
}
