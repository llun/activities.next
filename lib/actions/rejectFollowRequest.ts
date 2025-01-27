import { RejectFollow } from '@/lib/activities/actions/rejectFollow'
import { Database } from '@/lib/database/types'
import { FollowStatus } from '@/lib/models/follow'

interface RejectFollowRequestParams {
  activity: RejectFollow
  database: Database
}

export const rejectFollowRequest = async ({
  activity,
  database
}: RejectFollowRequestParams) => {
  const followRequestId = new URL(activity.object.id)
  const followId = followRequestId.pathname.slice(1)
  const follow = await database.getFollowFromId({ followId })
  if (!follow) return null
  await database.updateFollowStatus({
    followId,
    status: FollowStatus.enum.Rejected
  })
  return follow
}
