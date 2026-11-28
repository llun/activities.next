import { SYNC_HOSTED_BLUESKY_PROFILE_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

// Kept apart from `profile.ts` so the actor-update path (which the CommonJS
// queue worker reaches through the account-import job) does not load the
// `@atproto/*` modules that the hosted profile write needs.

/**
 * Queues `syncHostedBlueskyProfile` for `actorId`. Best effort: the profile is
 * already saved, and the next edit or the backfill retries. `dedupeWindowMs`
 * collapses repeated enqueues inside one window (the backfill); without it each
 * call is its own job, so an edit is never dropped.
 */
export const enqueueHostedBlueskyProfileSync = async ({
  actorId,
  dedupeWindowMs
}: {
  actorId: string
  dedupeWindowMs?: number
}): Promise<void> => {
  const suffix = dedupeWindowMs
    ? Math.floor(Date.now() / dedupeWindowMs)
    : Date.now()
  try {
    await getQueue().publish({
      id: getHashFromString(`${actorId}#bluesky-profile/${suffix}`),
      name: SYNC_HOSTED_BLUESKY_PROFILE_JOB_NAME,
      data: { actorId }
    })
  } catch (error) {
    logger.error({
      message: 'Could not queue the hosted Bluesky profile sync',
      actorId,
      err: toLoggableError(error)
    })
  }
}
