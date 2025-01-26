import { LikeStatus } from '@/lib/activities/actions/like'
import { Storage } from '@/lib/database/types'

interface LikeRequestParams {
  activity: LikeStatus
  storage: Storage
}

export const likeRequest = async ({ activity, storage }: LikeRequestParams) => {
  const request = activity as LikeStatus
  const statusId =
    typeof request.object === 'string' ? request.object : request.object.id

  await storage.createLike({
    statusId,
    actorId: request.actor
  })
}
