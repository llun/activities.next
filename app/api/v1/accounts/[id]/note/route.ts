import { z } from 'zod'

import { getRelationship } from '@/lib/services/accounts/relationship'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { getRequestBody } from '@/lib/utils/getRequestBody'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_400,
  ERROR_404,
  ERROR_422,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// Mastodon's note endpoint takes an optional `comment`; an empty comment clears
// the note. Omitting it entirely is treated the same as an empty string.
const NoteBodySchema = z.object({
  comment: z.string().optional()
})

interface Params {
  id: string
}

export const POST = traceApiRoute(
  'updateAccountNote',
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

    // getRequestBody calls req.json() for a JSON content type, which rejects on
    // an empty or malformed body; treat a bad body as a 422 rather than a 500.
    let rawBody: Record<string, unknown>
    try {
      rawBody = await getRequestBody(req)
    } catch {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: 422
      })
    }
    const parsedBody = NoteBodySchema.safeParse(rawBody)
    if (!parsedBody.success)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: 422
      })

    const targetActorId = idToUrl(encodedAccountId)

    if (targetActorId !== currentActor.id) {
      // Mirror the block/mute handlers: only store a note for an account that
      // actually exists locally, rather than accumulating notes for arbitrary
      // decodable IDs.
      const targetActor = await database.getActorFromId({ id: targetActorId })
      if (!targetActor)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })

      await database.upsertAccountNote({
        actorId: currentActor.id,
        targetActorId,
        comment: parsedBody.data.comment ?? ''
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
