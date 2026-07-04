import { z } from 'zod'

import { userAnnounce } from '@/lib/actions/announce'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { mastodonStatusResponse } from '@/lib/services/mastodon/statusActionResponse'
import { getReadableStatus } from '@/lib/services/statusRouteAccess'
import { Scope } from '@/lib/types/database/operations'
import { getRequestBody } from '@/lib/utils/getRequestBody'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_422,
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

// Mastodon's reblog endpoint accepts an optional visibility param. Boosts can
// only be public, unlisted, or private (limited/direct are not valid), and the
// param defaults to the booster's default privacy (public here) when omitted.
const ReblogBodySchema = z.object({
  visibility: z.enum(['public', 'unlisted', 'private']).optional()
})

export const POST = traceApiRoute(
  'reblogStatus',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:statuses']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const encodedStatusId = (await params).id
      if (!encodedStatusId) return apiCorsError(req, CORS_HEADERS, 404)

      // getRequestBody calls req.json() for a JSON content type, which rejects on
      // an empty or malformed body; catch it so a bad body yields a 422 rather
      // than an untraced 500.
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
      const parsedBody = ReblogBodySchema.safeParse(rawBody)
      if (!parsedBody.success)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })

      const statusId = idToUrl(encodedStatusId)
      const status = await getReadableStatus({
        database,
        statusId,
        currentActor,
        withReplies: false
      })
      if (!status) return apiCorsError(req, CORS_HEADERS, 404)

      const announceStatus = await userAnnounce({
        currentActor,
        statusId,
        database,
        visibility: parsedBody.data.visibility
      })

      if (!announceStatus) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }

      return mastodonStatusResponse({
        req,
        database,
        currentActor,
        status: announceStatus,
        allowedMethods: CORS_HEADERS
      })
    }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { statusId: params?.id || 'unknown' }
    }
  }
)
