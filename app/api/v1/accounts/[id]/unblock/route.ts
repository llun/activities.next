import { applyUnblock } from '@/lib/actions/applyUnblock'
import { SEND_UNBLOCK_JOB_NAME } from '@/lib/jobs/names'
import { getRelationship } from '@/lib/services/accounts/relationship'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getQueue } from '@/lib/services/queue'
import { Scope } from '@/lib/types/database/operations'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import {
  ERROR_400,
  ERROR_404,
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

      if (!existingBlock) {
        const targetActor = await database.getActorFromId({ id: targetActorId })
        if (!targetActor)
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_404,
            responseStatusCode: 404
          })
      }

      if (existingBlock) {
        await applyUnblock({
          database,
          actorId: currentActor.id,
          targetActorId
        })

        getQueue()
          .publish({
            id: getHashFromString(`${existingBlock.uri}/undo`),
            name: SEND_UNBLOCK_JOB_NAME,
            data: {
              actorId: currentActor.id,
              block: existingBlock
            }
          })
          .catch((error) => {
            logger.warn({
              message: 'Failed to queue unblock federation',
              actorId: currentActor.id,
              targetActorId,
              error
            })
          })
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
