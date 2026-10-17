import { VERIFY_PROFILE_LINKS_JOB_NAME } from '@/lib/jobs/names'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { profileFieldValuesChanged } from '@/lib/utils/profileFieldVerification'
import { toLoggableError } from '@/lib/utils/toLoggableError'

/**
 * Queue the rel="me" check of an actor's profile links, but only when the list
 * of field values differs from `before` (and is not empty), so a profile
 * refresh that changed nothing never fans out requests to the linked sites.
 * `before` is undefined for an actor that was just created.
 *
 * Best effort, like publishActorUpdate: the profile is already saved, so a
 * queue failure is logged instead of failing the request that saved it.
 */
export const queueProfileLinkVerification = async ({
  actorId,
  before,
  after
}: {
  actorId: string
  before: { value: string }[] | undefined
  after: { value: string }[]
}): Promise<void> => {
  if (after.length === 0 || !profileFieldValuesChanged(before, after)) return
  const requestedAt = Date.now()
  try {
    // Loaded here, not at the top: `recordActorIfNeeded` (lib/actions/utils)
    // calls this, and the queue module reaches every job, including the ones
    // that import `lib/actions/utils` back. A static import closes that cycle
    // and changes which copy of `recordActorIfNeeded` the jobs receive.
    const { getQueue } = await import('@/lib/services/queue')
    await getQueue().publish({
      id: getHashFromString(`${actorId}#verify-profile-links/${requestedAt}`),
      name: VERIFY_PROFILE_LINKS_JOB_NAME,
      data: { actorId }
    })
  } catch (error) {
    logger.error({
      message: 'Failed to queue the profile link verification',
      actorId,
      err: toLoggableError(error)
    })
  }
}
