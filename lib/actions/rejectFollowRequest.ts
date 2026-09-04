import { resolveFollowFromActivity } from '@/lib/actions/resolveFollowFromActivity'
import { RejectFollow } from '@/lib/activities/rejectFollow'
import { Database } from '@/lib/database/types'
import { FollowStatus } from '@/lib/types/domain/follow'

interface RejectFollowRequestParams {
  activity: RejectFollow
  database: Database
  recipientActorId?: string
}

export const rejectFollowRequest = async ({
  activity,
  database,
  recipientActorId
}: RejectFollowRequestParams) => {
  const follow = await resolveFollowFromActivity({
    activity,
    database,
    recipientActorId
  })
  if (!follow) return null
  if (follow.status === FollowStatus.enum.Rejected) {
    return follow
  }
  await database.updateFollowStatus({
    followId: follow.id,
    status: FollowStatus.enum.Rejected
  })
  return {
    ...follow,
    status: FollowStatus.enum.Rejected
  }
}
