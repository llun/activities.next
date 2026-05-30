// Follow notifications are grouped into bounded day-sized buckets rather than a
// single ever-growing group. The persisted group key encodes the UTC day so the
// list/detail/dismiss paths can match a bucket by exact string (no DB time-range
// query, which keeps it portable across SQLite and PostgreSQL).
const FOLLOW_GROUP_BUCKET_MS = 24 * 60 * 60 * 1000

/**
 * Builds the follow group key for a notification created at `createdAtMs`
 * (epoch milliseconds). All follows on the same UTC day share a key.
 */
export const followGroupKey = (createdAtMs: number): string =>
  `follow:${Math.floor(createdAtMs / FOLLOW_GROUP_BUCKET_MS)}`
