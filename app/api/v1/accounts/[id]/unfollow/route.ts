import { unfollow } from '@/lib/activities'
import { getRelationship } from '@/lib/services/accounts/relationship'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { FollowStatus } from '@/lib/types/domain/follow'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiCorsError, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const POST = traceApiRoute(
  'unfollowAccount',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:follows']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const encodedAccountId = (await params).id
      if (!encodedAccountId) return apiCorsError(req, CORS_HEADERS, 400)

      const targetActorId = idToUrl(encodedAccountId)

      const existingFollow = await database.getAcceptedOrRequestedFollow({
        actorId: currentActor.id,
        targetActorId
      })

      // Unknown target: Mastodon 404s instead of answering with an all-false
      // Relationship. A target the actor follows always has a local row, so
      // the existence check only matters when there is no follow to undo
      // (mirrors the mute route's local getActorFromId check).
      if (!existingFollow) {
        const targetActor = await database.getActorFromId({ id: targetActorId })
        if (!targetActor) return apiCorsError(req, CORS_HEADERS, 404)
      }

      if (existingFollow) {
        const canFederate = await canFederateWithDomain(database, targetActorId)
        const signingActor = canFederate
          ? await getFederationSigningActor(database)
          : undefined
        await Promise.all([
          canFederate
            ? unfollow(currentActor, existingFollow, signingActor)
            : undefined,
          database.updateFollowStatus({
            followId: existingFollow.id,
            status: FollowStatus.enum.Undo
          })
        ])
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
    }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)
