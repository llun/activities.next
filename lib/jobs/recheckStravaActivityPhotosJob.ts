import {
  StravaPhotoRecheckData,
  attachStravaPhotosToStatus,
  queueStravaPhotoRecheck
} from '@/lib/jobs/importStravaActivityJob'
import {
  RECHECK_STRAVA_ACTIVITY_PHOTOS_JOB_NAME,
  SEND_UPDATE_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { isMovedActor } from '@/lib/services/accounts/movedAccount'
import { getQueue } from '@/lib/services/queue'
import {
  getStravaActivity,
  getValidStravaAccessToken
} from '@/lib/services/strava/activity'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { createJobHandle } from './createJobHandle'

// Attaches Strava photos that arrived after a webhook import (see
// STRAVA_PHOTO_RECHECK_DELAYS_SECONDS), then queues the next check.
export const recheckStravaActivityPhotosJob = createJobHandle(
  RECHECK_STRAVA_ACTIVITY_PHOTOS_JOB_NAME,
  async (database, message) => {
    const data = StravaPhotoRecheckData.parse(message.data)
    const { actorId, statusId, stravaActivityId } = data

    const [actor, fitnessSettings, status] = await Promise.all([
      database.getActorFromId({ id: actorId }),
      database.getFitnessSettings({ actorId, serviceType: 'strava' }),
      database.getStatus({ statusId, withReplies: false })
    ])
    // The post was deleted or Strava disconnected since the import: nothing
    // to attach to, or no way to ask.
    if (!actor || !fitnessSettings || !status || status.actorId !== actorId) {
      return
    }

    let seenPhotoIds = data.seenPhotoIds
    try {
      const accessToken = await getValidStravaAccessToken({
        database,
        fitnessSettings
      })
      if (!accessToken) return

      const activity = await getStravaActivity({
        activityId: stravaActivityId,
        accessToken
      })
      const result = await attachStravaPhotosToStatus({
        database,
        actor,
        actorId,
        statusId,
        stravaActivityId,
        accessToken,
        activity,
        skipPhotoIds: seenPhotoIds
      })
      seenPhotoIds = result.seenPhotoIds

      // Same gate as the import's own photo Update, which the import already
      // resolved into publishSendNote; re-checked for a move since then.
      if (
        data.publishSendNote &&
        !isMovedActor(actor) &&
        result.attachedCount > 0
      ) {
        await getQueue().publish({
          id: getHashFromString(
            `${statusId}:${stravaActivityId}:${message.id}:strava-photos-recheck:send-update-note`
          ),
          name: SEND_UPDATE_NOTE_JOB_NAME,
          data: { actorId, statusId }
        })
      }
    } catch (error) {
      // Best effort: a failed check (Strava down, activity deleted there)
      // still leaves the next one scheduled below.
      logger.warn({
        message: 'Failed to re-check Strava activity photos',
        actorId,
        stravaActivityId,
        statusId,
        attempt: data.attempt,
        err: toLoggableError(error)
      })
    }

    await queueStravaPhotoRecheck({
      ...data,
      seenPhotoIds,
      attempt: data.attempt + 1
    })
  }
)
