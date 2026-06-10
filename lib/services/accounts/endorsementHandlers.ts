import { getRelationship } from '@/lib/services/accounts/relationship'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiCorsError, apiResponse } from '@/lib/utils/response'
import { idToUrl } from '@/lib/utils/urlToId'

export const ENDORSEMENT_CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.POST
]

const guardOptions = {
  errorResponse: corsErrorResponse(ENDORSEMENT_CORS_HEADERS)
}

interface Params {
  id: string
}

// Shared handler for POST /api/v1/accounts/:id/pin and /endorse.
// Features (endorses) an account on the current actor's profile.
// Mastodon only allows featuring accounts you follow.
export const endorseAccountHandler = OAuthGuardAnyScope<Params>(
  [Scope.enum.write, Scope.enum['write:accounts']],
  async (req, context) => {
    const { database, currentActor, params } = context
    const encodedAccountId = (await params).id
    if (!encodedAccountId)
      return apiCorsError(req, ENDORSEMENT_CORS_HEADERS, 400)

    const targetActorId = idToUrl(encodedAccountId)
    const target = await database.getActorFromId({ id: targetActorId })
    if (!target) return apiCorsError(req, ENDORSEMENT_CORS_HEADERS, 404)

    const isFollowing = await database.isCurrentActorFollowing({
      currentActorId: currentActor.id,
      followingActorId: targetActorId
    })
    if (!isFollowing) {
      return apiResponse({
        req,
        allowedMethods: ENDORSEMENT_CORS_HEADERS,
        data: { error: 'You must be following the account to feature it.' },
        responseStatusCode: 422
      })
    }

    await database.createEndorsement({
      actorId: currentActor.id,
      targetActorId
    })

    const relationship = await getRelationship({
      database,
      currentActor,
      targetActorId
    })
    return apiResponse({
      req,
      allowedMethods: ENDORSEMENT_CORS_HEADERS,
      data: relationship
    })
  },
  guardOptions
)

// Shared handler for POST /api/v1/accounts/:id/unpin and /unendorse.
// Stops featuring (unendorses) an account on the current actor's profile.
export const unendorseAccountHandler = OAuthGuardAnyScope<Params>(
  [Scope.enum.write, Scope.enum['write:accounts']],
  async (req, context) => {
    const { database, currentActor, params } = context
    const encodedAccountId = (await params).id
    if (!encodedAccountId)
      return apiCorsError(req, ENDORSEMENT_CORS_HEADERS, 400)

    const targetActorId = idToUrl(encodedAccountId)
    const target = await database.getActorFromId({ id: targetActorId })
    if (!target) return apiCorsError(req, ENDORSEMENT_CORS_HEADERS, 404)

    await database.deleteEndorsement({
      actorId: currentActor.id,
      targetActorId
    })

    const relationship = await getRelationship({
      database,
      currentActor,
      targetActorId
    })
    return apiResponse({
      req,
      allowedMethods: ENDORSEMENT_CORS_HEADERS,
      data: relationship
    })
  },
  guardOptions
)
