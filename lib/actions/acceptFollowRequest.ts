import { resolveFollowFromActivity } from '@/lib/actions/resolveFollowFromActivity'
import { AcceptFollow } from '@/lib/activities/acceptFollow'
import { Database } from '@/lib/database/types'
import {
  FOLLOW_TIMELINE_BACKFILL_JOB_NAME,
  SEND_UNDO_FOLLOW_JOB_NAME
} from '@/lib/jobs/names'
import { buildFollowEmail } from '@/lib/services/email/templates/follow'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { getQueue } from '@/lib/services/queue'
import { NotificationType } from '@/lib/types/database/operations'
import { FollowStatus } from '@/lib/types/domain/follow'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

interface AcceptFollowRequestParams {
  activity: AcceptFollow
  database: Database
  recipientActorId?: string
}

export const acceptFollowRequest = async ({
  activity,
  database,
  recipientActorId
}: AcceptFollowRequestParams) => {
  const follow = await resolveFollowFromActivity({
    activity,
    database,
    recipientActorId
  })
  if (!follow) return null

  if (
    await database.isEitherBlocking({
      actorIdA: follow.actorId,
      actorIdB: follow.targetActorId
    })
  ) {
    await database.updateFollowStatus({
      followId: follow.id,
      status: FollowStatus.enum.Undo
    })

    getQueue()
      .publish({
        id: getHashFromString(`${follow.id}/undo`),
        name: SEND_UNDO_FOLLOW_JOB_NAME,
        data: {
          actorId: follow.actorId,
          follow
        }
      })
      .catch((error) => {
        logger.warn({
          err: toLoggableError(error),
          message: 'Failed to queue Undo Follow federation',
          actorId: follow.actorId,
          targetActorId: follow.targetActorId,
          followId: follow.id
        })
      })

    return {
      ...follow,
      status: FollowStatus.enum.Undo
    }
  }

  const wasAlreadyAccepted = follow.status === FollowStatus.enum.Accepted
  await database.updateFollowStatus({
    followId: follow.id,
    status: FollowStatus.enum.Accepted
  })

  const [actor, targetActor] = await Promise.all([
    database.getActorFromId({ id: follow.actorId }),
    database.getActorFromId({ id: follow.targetActorId })
  ])

  if (!wasAlreadyAccepted && actor && targetActor?.account) {
    sendNotificationAlerts({
      database,
      actorId: targetActor.id,
      sourceActorId: actor.id,
      sourceActor: actor,
      events: [
        {
          type: NotificationType.enum.follow,
          emailContent: {
            recipientEmail: targetActor.account.email,
            ...buildFollowEmail({ recipient: targetActor, actor })
          }
        }
      ]
    })
  }

  // Populate the new follower's home timeline: first discovery of a remote
  // actor backfills their recent outbox; an actor we already have statuses
  // for gets those merged in. The job re-checks every gate; this only
  // requires what is knowable here — a local follower. Published after
  // updateFollowStatus committed Accepted so the job sees the follow.
  // Dedup id is per follow row (#backfill suffix keeps it clear of every
  // other job's id space; an Accept redelivery dedups, and the job is
  // safe against repeated execution anyway).
  if (actor?.account) {
    getQueue()
      .publish({
        id: getHashFromString(`${follow.id}#backfill`),
        name: FOLLOW_TIMELINE_BACKFILL_JOB_NAME,
        data: { actorId: follow.actorId, targetActorId: follow.targetActorId }
      })
      .catch((error) => {
        logger.warn({
          err: toLoggableError(error),
          message: 'Failed to queue follow timeline backfill',
          actorId: follow.actorId,
          targetActorId: follow.targetActorId
        })
      })
  }

  return {
    ...follow,
    status: FollowStatus.enum.Accepted
  }
}
