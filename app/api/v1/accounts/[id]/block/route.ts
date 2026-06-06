import { randomUUID } from 'node:crypto'

import { applyBlock } from '@/lib/actions/applyBlock'
import {
  BlockedFederationDomainError,
  recordActorIfNeeded
} from '@/lib/actions/utils'
import { SEND_BLOCK_JOB_NAME } from '@/lib/jobs/names'
import { getRelationship } from '@/lib/services/accounts/relationship'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getQueue } from '@/lib/services/queue'
import { Scope } from '@/lib/types/database/operations'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import {
  ERROR_403,
  apiCorsError,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const POST = traceApiRoute(
  'blockAccount',
  OAuthGuard<Params>([Scope.enum.write], async (req, context) => {
    const { database, currentActor, params } = context
    const encodedAccountId = (await params).id
    if (!encodedAccountId) return apiCorsError(req, CORS_HEADERS, 400)

    const targetActorId = idToUrl(encodedAccountId)

    if (targetActorId !== currentActor.id) {
      let targetActor
      try {
        targetActor = await recordActorIfNeeded({
          actorId: targetActorId,
          database
        })
      } catch (error) {
        if (error instanceof BlockedFederationDomainError) {
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_403,
            responseStatusCode: 403
          })
        }
        throw error
      }
      if (!targetActor) return apiCorsError(req, CORS_HEADERS, 404)

      const blockId = randomUUID()
      const uri = `${currentActor.id}#blocks/${blockId}`
      const block = await applyBlock({
        database,
        actorId: currentActor.id,
        targetActorId,
        uri
      })

      getQueue()
        .publish({
          id: getHashFromString(block.uri),
          name: SEND_BLOCK_JOB_NAME,
          data: {
            actorId: currentActor.id,
            targetActorId,
            uri: block.uri
          }
        })
        .catch((error) => {
          logger.warn({
            message: 'Failed to queue block federation',
            actorId: currentActor.id,
            targetActorId,
            error
          })
        })
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
