// Dependency-free so first-load code (DraftsProvider) can read the queue timing
// without pulling the whole sender into its chunk.

/** A queued post older than this goes to Needs review before its first POST. */
export const MAX_QUEUE_AGE_MS = 86_400_000
/** Give up confirming whether a post landed after this long. */
export const CHECKING_GIVE_UP_MS = 6 * 86_400_000
export const SEND_TIMEOUT_MS = 30_000
export const CLAIM_LEASE_MS = 90_000
/** Backoff per attempt; the last value repeats. */
export const SEND_BACKOFF_MS = [
  5_000, 15_000, 45_000, 120_000, 300_000
] as const
export const DEFAULT_RETRY_AFTER_MS = 60_000
