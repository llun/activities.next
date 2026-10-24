import { z } from 'zod'

import { followActor } from '@/lib/actions/followActor'
import { parseFollowRequestBody } from '@/lib/services/accounts/parseFollowRequestBody'
import { getRelationship } from '@/lib/services/accounts/relationship'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { resolveActorIdParam } from '@/lib/services/mastodon/resolveClientId'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_422,
  HTTP_STATUS,
  apiCorsError,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// Form bodies carry booleans as strings ("false" must become false, not a
// truthy non-empty string), so coerce known string forms before validation.
const TRUE_VALUES = new Set(['true', '1', 'on', 'yes'])
const FALSE_VALUES = new Set(['false', '0', 'off', 'no'])
const BooleanParam = z.preprocess((value) => {
  if (typeof value === 'string') {
    const lower = value.toLowerCase()
    if (TRUE_VALUES.has(lower)) return true
    if (FALSE_VALUES.has(lower)) return false
  }
  return value
}, z.boolean())

// Mastodon's follow endpoint accepts optional reblogs, notify, and languages[].
const FollowBodySchema = z.object({
  reblogs: BooleanParam.optional(),
  notify: BooleanParam.optional(),
  languages: z.array(z.string().min(1)).optional()
})

interface Params {
  id: string
}

export const POST = traceApiRoute(
  'followAccount',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:follows']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const encodedAccountId = (await params).id
      if (!encodedAccountId) return apiCorsError(req, CORS_HEADERS, 400)

      // A malformed JSON body rejects in parseFollowRequestBody; treat it as an
      // unprocessable request rather than letting it surface as a 500 or be
      // silently coerced into a default (paramless) follow.
      let rawBody: Record<string, unknown>
      try {
        rawBody = await parseFollowRequestBody(req)
      } catch {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }
      const parsedBody = FollowBodySchema.safeParse(rawBody)
      if (!parsedBody.success)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      const { reblogs, notify, languages } = parsedBody.data

      const requestedActorId = await resolveActorIdParam(
        database,
        encodedAccountId
      )
      const result = await followActor({
        database,
        currentActor,
        requestedActorId,
        reblogs,
        notify,
        languages
      })
      if (result.type === 'forbidden') {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Forbidden' },
          responseStatusCode: HTTP_STATUS.FORBIDDEN
        })
      }
      if (result.type === 'not-found') {
        return apiCorsError(req, CORS_HEADERS, 404)
      }
      const { targetActorId } = result

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
