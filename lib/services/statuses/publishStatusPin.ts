import { SEND_FEATURED_STATUS_JOB_NAME } from '@/lib/jobs/names'
import {
  type PinFederationAction,
  getFeaturedStatusActivityId
} from '@/lib/jobs/sendFeaturedStatusJob'
import { getQueue } from '@/lib/services/queue'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

let lastWallNow = 0
let lastTimestamp = 0

export const nextPinEventTimestamp = (): number => {
  const now = Date.now()
  if (now < lastWallNow) {
    lastWallNow = now
    lastTimestamp = now
    return now
  }
  lastWallNow = now
  lastTimestamp = now > lastTimestamp ? now : lastTimestamp + 1
  return lastTimestamp
}

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
  action,
  timestamp = nextPinEventTimestamp()
}: {
  actorId: string
  statusId: string
  action: PinFederationAction
  timestamp?: number
}): Promise<void> => {
  const activityId = getFeaturedStatusActivityId({
    statusId,
    action,
    timestamp
  })
  try {
    await getQueue().publish({
      id: getHashFromString(activityId),
      name: SEND_FEATURED_STATUS_JOB_NAME,
      data: {
        actorId,
        statusId,
        action,
        timestamp
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
