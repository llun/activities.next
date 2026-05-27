import { acceptFollow } from '@/lib/activities'
import { FollowRequest } from '@/lib/activities/followAction'
import { getRelationship } from '@/lib/services/accounts/relationship'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { FollowStatus } from '@/lib/types/domain/follow'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_404,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'authorizeFollowRequest',
  AuthenticatedGuard<{ id: string }>(
    async (req, { currentActor, database, params }) => {
      if (!database) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_500,
          responseStatusCode: 500
        })
      }

      const { id } = await params
      const accountId = decodeURIComponent(id)

      // Find the follow request from this account to current actor
      const follow = await database.getAcceptedOrRequestedFollow({
        actorId: accountId,
        targetActorId: currentActor.id
      })

      if (!follow || follow.status !== FollowStatus.enum.Requested) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      // Get the follower actor for sending Accept activity
      const followerActor = await database.getActorFromId({
        id: follow.actorId
      })
      if (!followerActor) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      // Update status to Accepted
      await database.updateFollowStatus({
        followId: follow.id,
        status: FollowStatus.enum.Accepted
      })

      // Send Accept activity
      const followRequest: FollowRequest = {
        id: `https://${followerActor.domain}/${follow.id}`,
        type: 'Follow',
        actor: follow.actorId,
        object: follow.targetActorId
      }
      await acceptFollow(currentActor, followerActor.inboxUrl, followRequest)

      // Note: No separate notification is created here because the original
      // follow action already creates a notification for the target actor.
      // Creating another one here would target the wrong actor (the remote follower).

      const relationship = await getRelationship({
        database,
        currentActor,
        targetActorId: accountId
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: relationship
      })
    }
  )
)
