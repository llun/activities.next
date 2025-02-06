import { LikeStatus } from '@/lib/activities/actions/like'
import { Database } from '@/lib/database/types'

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
}
