// At most one tab drains the send queue at a time. The lock only avoids
// duplicate work: correctness comes from the claim and revision checks in
// draftsDb, so a browser without Web Locks just runs the drain.
import { generatePublicId } from '@/lib/utils/publicId'

export const SENDER_LOCK_NAME = 'activities-drafts-sender'

/** One per tab (module load): the owner of a claim's lease. */
export const TAB_ID = generatePublicId()

/**
 * Runs `fn` unless another tab holds the lock. Resolves false when it did not
 * run, so the caller can try again once that tab's pass is over.
 */
export const withSenderLock = async (
  fn: () => Promise<void>
): Promise<boolean> => {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!locks) {
    await fn()
    return true
  }
  return locks.request(
    SENDER_LOCK_NAME,
    { ifAvailable: true },
    async (lock) => {
      if (!lock) return false
      await fn()
      return true
    }
  )
}
