import { SEND_FEATURED_STATUS_JOB_NAME } from '@/lib/jobs/names'
import {
  type PinFederationAction,
  getFeaturedStatusActivityId
} from '@/lib/jobs/sendFeaturedStatusJob'
import { getQueue } from '@/lib/services/queue'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

/**
 * Queue the Add or Remove activity that tells remote servers a local status was
 * added to or removed from the actor's featured collection.
 *
 * Best effort: the pin state is already saved, and remote servers can still
 * read the featured collection directly, so a queue failure is logged rather
 * than failing the API request.
 */
export const publishStatusPin = async ({
  actorId,
  statusId,
  action
}: {
  actorId: string
  statusId: string
  action: PinFederationAction
}): Promise<void> => {
  const eventId = crypto.randomUUID()
  const activityId = getFeaturedStatusActivityId({
    statusId,
    action,
    eventId
  })
  try {
    await getQueue().publish({
      id: getHashFromString(activityId),
      name: SEND_FEATURED_STATUS_JOB_NAME,
      data: {
        actorId,
        statusId,
        action,
        eventId
      }
    })
  } catch (error) {
    logger.error({
      message: 'Failed to queue pinned status federation',
      actorId,
      statusId,
      action,
      err: toLoggableError(error)
    })
  }
}
