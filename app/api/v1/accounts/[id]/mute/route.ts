import { z } from 'zod'

import { applyMute } from '@/lib/actions/applyMute'
import { getRelationship } from '@/lib/services/accounts/relationship'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { getRequestBody } from '@/lib/utils/getRequestBody'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiCorsError, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// Form bodies arrive as strings, so a native client sending `notifications=false`
// would otherwise be coerced to `true`. Map the textual booleans Mastodon clients
// send before validating; non-string (JSON) values pass through unchanged.
const coerceBoolean = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  const normalized = value.trim().toLowerCase()
  if (['false', '0', 'no', 'off'].includes(normalized)) return false
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true
  return value
}

const MuteBodySchema = z.object({
  notifications: z
    .preprocess(coerceBoolean, z.boolean())
    .catch(true)
    .optional(),
  duration: z.coerce
    .number()
    .finite()
    .min(0)
    .max(3_153_600_000)
    .transform(Math.floor)
    .catch(0)
    .optional()
})

interface Params {
  id: string
}

export const POST = traceApiRoute(
  'muteAccount',
  OAuthGuard<Params>([Scope.enum.write], async (req, context) => {
    const { database, currentActor, params } = context
    const encodedAccountId = (await params).id
    if (!encodedAccountId) return apiCorsError(req, CORS_HEADERS, 400)

    const targetActorId = idToUrl(encodedAccountId)

    if (targetActorId !== currentActor.id) {
      const targetActor = await database.getActorFromId({ id: targetActorId })
      if (!targetActor) return apiCorsError(req, CORS_HEADERS, 404)

      const rawBody = await getRequestBody(req).catch(() => ({}))
      const body = MuteBodySchema.safeParse(rawBody).data ?? {}
      const notifications: boolean = body.notifications !== false
      const durationSeconds = body.duration ?? 0
      const endsAt =
        durationSeconds > 0 ? Date.now() + durationSeconds * 1000 : null
      await applyMute({
        database,
        actorId: currentActor.id,
        targetActorId,
        notifications,
        endsAt
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
