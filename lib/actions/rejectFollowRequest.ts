import { RejectFollow } from '@/lib/activities/actions/rejectFollow'
import { Database } from '@/lib/database/types'
import { FollowStatus } from '@/lib/models/follow'

interface RejectFollowRequestParams {
  activity: RejectFollow
  storage: Database
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
    status: FollowStatus.enum.Rejected
  })
  return follow
}
