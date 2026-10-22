// At most one tab drains the send queue at a time. The lock only avoids
// duplicate work: correctness comes from the claim and revision checks in
// draftsDb, so a browser without Web Locks just runs the drain.
import { generatePublicId } from '@/lib/utils/publicId'

export const SENDER_LOCK_NAME = 'activities-drafts-sender'

/** One per tab (module load): the owner of a claim's lease. */
export const TAB_ID = generatePublicId()

/** Runs `fn` unless another tab holds the lock, in which case it does nothing. */
export const withSenderLock = async (
  fn: () => Promise<void>
): Promise<void> => {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!locks) return fn()
  await locks.request(SENDER_LOCK_NAME, { ifAvailable: true }, (lock) =>
    lock ? fn() : undefined
  )
}
