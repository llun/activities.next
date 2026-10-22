// Dependency-free (type imports only) so first-load code (DraftsProvider) can
// read the queue timing without pulling the whole sender into its chunk.
import type { DraftQueueState } from './types'

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
/** Tries for an upload refused without a status: about 8 minutes of backoff. */
export const UPLOAD_RETRY_LIMIT = 6

/** A 401 or a profile switch: the queue waits for the next load to lift it. */
export const holdsQueue = (queue: DraftQueueState | undefined): boolean =>
  queue?.state === 'paused' &&
  (queue.pausedBy === 'auth' || queue.pausedBy === 'actor')

/**
 * What Pause makes of an item that would retry on its own. Only a rate limit
 * carries a reason ("trying again soon"), which no longer holds.
 */
export const pausedByReader = (queue: DraftQueueState): DraftQueueState => {
  const { reason: _reason, ...rest } = queue
  return { ...rest, state: 'paused', pausedBy: 'user' }
}

/**
 * States the sender retries without the user once `nextAttemptAt` passes;
 * the rest (needs review, couldn't send, paused by the user, auth or actor)
 * wait for them. A `sending` entry is the lease's, not this rule's.
 */
export const retriesOnItsOwn = (queue: DraftQueueState): boolean =>
  queue.state === 'waiting' ||
  queue.state === 'checking' ||
  (queue.state === 'paused' && queue.pausedBy === 'rate_limit')
