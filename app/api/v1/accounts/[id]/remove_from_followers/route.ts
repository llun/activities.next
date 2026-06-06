import { rejectFollow } from '@/lib/activities'
import { FollowRequest } from '@/lib/activities/followAction'
import { getRelationship } from '@/lib/services/accounts/relationship'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { FollowStatus } from '@/lib/types/domain/follow'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { apiCorsError, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

// POST /api/v1/accounts/:id/remove_from_followers — remove the given account
// from the current user's followers.
// https://docs.joinmastodon.org/methods/accounts/#remove_from_followers
// Scope: write:follows (satisfied by aggregate `write`).
export const POST = traceApiRoute(
  'removeAccountFromFollowers',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:follows']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const encodedAccountId = (await params).id
      if (!encodedAccountId) return apiCorsError(req, CORS_HEADERS, 400)

      const targetActorId = idToUrl(encodedAccountId)

      // The follow we want to drop is the one where the target follows us.
      const follow = await database.getAcceptedOrRequestedFollow({
        actorId: targetActorId,
        targetActorId: currentActor.id
      })

      if (follow && follow.status === FollowStatus.enum.Accepted) {
        await database.updateFollowStatus({
          followId: follow.id,
          status: FollowStatus.enum.Undo
        })
        await Promise.all([
          database.updateActorFollowersCount(currentActor.id),
          database.updateActorFollowingCount(targetActorId)
        ])

        // Federate the removal to remote followers so they learn they were
        // removed (Mastodon sends a Reject for the original Follow).
        const followerActor = await database.getActorFromId({
          id: targetActorId
        })
        if (followerActor && followerActor.domain !== currentActor.domain) {
          const followRequest: FollowRequest = {
            id: `https://${followerActor.domain}/${follow.id}`,
            type: 'Follow',
            actor: follow.actorId,
            object: follow.targetActorId
          }
          try {
            await rejectFollow(
              currentActor,
              followerActor.inboxUrl,
              followRequest
            )
          } catch (error) {
            logger.error(
              { error, followId: follow.id },
              'Failed to federate remove_from_followers Reject'
            )
          }
        }
      }

      const relationship = await getRelationship({
        database,
        currentActor,
        targetActorId
      })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: relationship
      })
    },
    guardOptions
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)
