import { AcceptFollow } from '../activities/actions/acceptFollow'
import { FollowStatus } from '../models/follow'
import { Storage } from '../storage/types'

interface AcceptFollowRequestParams {
  activity: AcceptFollow
  storage: Storage
}

export const acceptFollowRequest = async ({
  activity,
  storage
}: AcceptFollowRequestParams) => {
  const followRequestId = new URL(activity.object.id)
  const followId = followRequestId.pathname.slice(1)
  const follow = await storage.getFollowFromId({ followId })
  if (!follow) return null
  await storage.updateFollowStatus({
    followId,
    status: FollowStatus.enum.Accepted
  })
  return follow
}
