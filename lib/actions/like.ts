import { LikeStatus } from '../activities/actions/like'
import { Storage } from '../storage/types'

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
