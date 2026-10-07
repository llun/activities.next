import { SEND_UPDATE_ACTOR_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

/**
 * Queue the Update(Person) that tells remote servers a local profile changed.
 *
 * Best effort: the profile is already saved, and remote servers still pick the
 * change up on their own periodic re-fetch, so a queue failure is logged rather
 * than failing the request that saved it.
 */
export const publishActorUpdate = async ({
  actorId
}: {
  actorId: string
}): Promise<void> => {
  const updatedAt = Date.now()
  try {
    await getQueue().publish({
      id: getHashFromString(`${actorId}#updates/${updatedAt}`),
      name: SEND_UPDATE_ACTOR_JOB_NAME,
      data: { actorId, updatedAt }
    })
  } catch (error) {
    logger.error({
      message: 'Failed to queue the actor profile update for federation',
      actorId,
      err: toLoggableError(error)
    })
  }
}
