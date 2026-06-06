import { z } from 'zod'

import { follow } from '@/lib/activities'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { parseFollowRequestBody } from '@/lib/services/accounts/parseFollowRequestBody'
import { getRelationship } from '@/lib/services/accounts/relationship'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { FollowStatus } from '@/lib/types/domain/follow'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_422,
  HTTP_STATUS,
  apiCorsError,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

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
  OAuthGuard<Params>([Scope.enum.write], async (req, context) => {
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

    const targetActorId = idToUrl(encodedAccountId)
    if (!(await canFederateWithDomain(database, targetActorId))) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { status: 'Forbidden' },
        responseStatusCode: HTTP_STATUS.FORBIDDEN
      })
    }

    // Updating preferences on an account the actor already follows is a purely
    // local operation, so resolve the existing follow before any network call.
    // This lets clients change reblogs/notify/languages even when the remote
    // actor is temporarily unreachable.
    const existingFollow = await database.getAcceptedOrRequestedFollow({
      actorId: currentActor.id,
      targetActorId
    })

    if (existingFollow) {
      if (
        reblogs !== undefined ||
        notify !== undefined ||
        languages !== undefined
      ) {
        await database.updateFollowPreferences({
          actorId: currentActor.id,
          targetActorId,
          reblogs,
          notify,
          languages
        })
      }
    } else {
      // New follow: confirm the target actor exists (network) before creating.
      const signingActor = await getFederationSigningActor(database)
      const person = await getActorPerson({
        actorId: targetActorId,
        signingActor
      })
      if (!person) return apiCorsError(req, CORS_HEADERS, 404)

      const followItem = await database.createFollow({
        actorId: currentActor.id,
        targetActorId,
        status: FollowStatus.enum.Requested,
        inbox: `${currentActor.id}/inbox`,
        sharedInbox: `https://${currentActor.domain}/inbox`,
        reblogs,
        notify,
        languages
      })
      await follow(followItem.id, currentActor, targetActorId, signingActor)
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
