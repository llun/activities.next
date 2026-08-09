import { rejectFollow } from '@/lib/activities'
import { FollowRequest } from '@/lib/activities/followAction'
import { getRelationship } from '@/lib/services/accounts/relationship'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { resolveActorIdParam } from '@/lib/services/mastodon/resolveClientId'
import { Scope } from '@/lib/types/database/operations'
import { FollowStatus } from '@/lib/types/domain/follow'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_404, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'rejectFollowRequest',
  OAuthGuardAnyScope<{ id: string }>(
    [Scope.enum.write, Scope.enum['write:follows']],
    async (req, { currentActor, database, params }) => {
      const { id } = await params
      // Accept every id form a GET endpoint has handed out: a UUIDv7 publicId
      // (what they emit now), the legacy urlToId form (what a Mastodon client
      // cached before the flip still sends), and a raw actor URL (the
      // first-party UI's historical shape) so the UI migration is
      // non-breaking. resolveActorIdParam's raw-URL fast path absorbs the
      // http(s) case instead of letting idToUrl mangle the scheme colon.
      const rawId = decodeURIComponent(id)
      const accountId = await resolveActorIdParam(database, rawId)

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

      // Get the follower actor for sending Reject activity
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

      // Return the real relationship (the request is no longer pending) rather
      // than a hardcoded all-false literal, matching the authorize route and
      // every other relationship response (id in the same form the account
      // entities carry, languages null).
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
    },
    { errorResponse: corsErrorResponse(CORS_HEADERS) }
  )
)
