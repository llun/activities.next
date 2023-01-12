import { RejectFollow } from '../activities/actions/rejectFollow'
import { FollowStatus } from '../models/follow'
import { Storage } from '../storage/types'

interface RejectFollowRequestParams {
  activity: RejectFollow
  storage: Storage
}

export const rejectFollowRequest = async ({
  activity,
  storage
}: RejectFollowRequestParams) => {
  const followRequestId = new URL(activity.object.id)
  const followId = followRequestId.pathname.slice(1)
  const follow = await storage.getFollowFromId({ followId })
  if (!follow) return null
  await storage.updateFollowStatus({
    followId,
    status: FollowStatus.Rejected
  })
  return follow
}
