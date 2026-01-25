import { rejectFollow } from '@/lib/activities'
import { FollowRequest } from '@/lib/activities/actions/follow'
import { FollowStatus } from '@/lib/models/follow'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'rejectFollowRequest',
  AuthenticatedGuard<{ id: string }>(
    async (req, { currentActor, database, params }) => {
      if (!database) {
        return apiErrorResponse(500)
      }

      const { id } = await params
      const accountId = decodeURIComponent(id)

      // Find the follow request from this account to current actor
      const follow = await database.getAcceptedOrRequestedFollow({
        actorId: accountId,
        targetActorId: currentActor.id
      })

      if (!follow || follow.status !== FollowStatus.enum.Requested) {
        return apiErrorResponse(404)
      }

      // Get the follower actor for sending Reject activity
      const followerActor = await database.getActorFromId({
        id: follow.actorId
      })
      if (!followerActor) {
        return apiErrorResponse(404)
      }

      // Update status to Rejected
      await database.updateFollowStatus({
        followId: follow.id,
        status: FollowStatus.enum.Rejected
      })

      // Send Reject activity
      const followRequest: FollowRequest = {
        id: `https://${followerActor.domain}/${follow.id}`,
        type: 'Follow',
        actor: follow.actorId,
        object: follow.targetActorId
      }
      await rejectFollow(currentActor, followerActor.inboxUrl, followRequest)

      // Return relationship
      const relationship = {
        id: accountId,
        following: false,
        showing_reblogs: true,
        notifying: false,
        languages: [],
        followed_by: false,
        blocking: false,
        blocked_by: false,
        muting: false,
        muting_notifications: false,
        requested: false,
        requested_by: false,
        domain_blocking: false,
        endorsed: false,
        note: ''
      }

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: relationship
      })
    }
  )
)
