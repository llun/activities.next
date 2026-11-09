import { z } from 'zod'

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
import {
  MAX_STRAVA_PHOTOS_TO_ATTACH,
  attachStravaPhotosToStatus
} from '@/lib/services/strava/attachStravaPhotos'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { createJobHandle } from './createJobHandle'

// Strava sends no webhook when photos are added to an activity, and apps such
// as Rouvy add theirs only after the activity upload, so the import usually
// runs before they exist. A fresh webhook import therefore re-checks Strava
// this long after it ran (10 minutes, then about an hour).
export const STRAVA_PHOTO_RECHECK_DELAYS_SECONDS = [10 * 60, 50 * 60]

export const StravaPhotoRecheckData = z.object({
  actorId: z.string(),
  statusId: z.string(),
  stravaActivityId: z.string(),
  // Strava photo ids already on the status at some check. A later check never
  // attaches these again, so a photo the owner removed stays removed.
  seenPhotoIds: z.array(z.string()),
  // Whether a photo this check attaches may federate an Update: the import's
  // own gate, already resolved (opt-in, not moved, process job queued). The
  // check adds its own proof that the Create went out before using it.
  publishSendNote: z.boolean(),
  attempt: z.number().int().min(0)
})
export type StravaPhotoRecheckData = z.infer<typeof StravaPhotoRecheckData>

export const queueStravaPhotoRecheck = async (data: StravaPhotoRecheckData) => {
  const delaySeconds = STRAVA_PHOTO_RECHECK_DELAYS_SECONDS[data.attempt]
  if (delaySeconds === undefined) return
  // Nothing left to find: the Strava photo cap is spent.
  if (data.seenPhotoIds.length >= MAX_STRAVA_PHOTOS_TO_ATTACH) return

  await getQueue().publish({
    id: getHashFromString(
      `${data.statusId}:${data.stravaActivityId}:strava-photos-recheck:${data.attempt}`
    ),
    name: RECHECK_STRAVA_ACTIVITY_PHOTOS_JOB_NAME,
    data,
    delaySeconds
  })
}

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

      // The import's own photo-Update gate, resolved into publishSendNote and
      // re-checked for a move since then, plus proof the Create was queued:
      // processFitnessFileJob queues it only when the primary file completes.
      // sendUpdateNoteJob checks nothing itself, and an Update for a post that
      // never had a Create would publish it. If processing has not finished
      // yet, the Create it queues later carries these photos.
      // shortcut: a primary that failed and was retried by hand completes
      // without a Create, which this cannot tell; record the Create if that
      // case ever matters.
      const primaryFile =
        data.publishSendNote && !isMovedActor(actor) && result.attachedCount > 0
          ? (await database.getFitnessFilesByStatus({ statusId })).find(
              (file) => file.isPrimary !== false
            )
          : undefined
      if (primaryFile?.processingStatus === 'completed') {
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
