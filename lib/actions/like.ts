import { LikeStatus } from '@/lib/activities/actions/like'
import { Database } from '@/lib/database/types'
import { NotificationType } from '@/lib/database/types/notification'

interface LikeRequestParams {
  activity: LikeStatus
  database: Database
}

export const likeRequest = async ({
  activity,
  database
}: LikeRequestParams) => {
  const request = activity as LikeStatus
  const statusId =
    typeof request.object === 'string' ? request.object : request.object.id

  await database.createLike({
    statusId,
    actorId: request.actor
  })

  // Create like notification
  const status = await database.getStatus({ statusId })
  if (status && status.actorId !== request.actor) {
    await database.createNotification({
      actorId: status.actorId,
      type: NotificationType.enum.like,
      sourceActorId: request.actor,
      statusId: status.id,
      groupKey: `like:${status.id}`
    })
  }
}
