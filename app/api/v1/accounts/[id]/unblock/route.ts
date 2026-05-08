import { applyUnblock } from '@/lib/actions/applyUnblock'
import { unblock as federateUnblock } from '@/lib/activities'
import { getRelationship } from '@/lib/services/accounts/relationship'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { ERROR_400, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const POST = traceApiRoute(
  'unblockAccount',
  OAuthGuard<Params>([Scope.enum.write], async (req, context) => {
    const { database, currentActor, params } = context
    const encodedAccountId = (await params).id
    if (!encodedAccountId)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })

    const targetActorId = idToUrl(encodedAccountId)

    if (targetActorId !== currentActor.id) {
      const existingBlock = await database.getBlock({
        actorId: currentActor.id,
        targetActorId
      })

      if (existingBlock) {
        await applyUnblock({
          database,
          actorId: currentActor.id,
          targetActorId
        })

        if (await canFederateWithDomain(database, targetActorId)) {
          const signingActor = await getFederationSigningActor(database)
          await federateUnblock(currentActor, existingBlock, signingActor)
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
  }),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)
