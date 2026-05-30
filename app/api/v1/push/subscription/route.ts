import { getConfig } from '@/lib/config'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { getRequestBody } from '@/lib/utils/getRequestBody'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_404, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

import {
  parseAlertsInput,
  parsePolicyInput,
  parseSubscribeInput,
  toWebPushSubscription
} from './types'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.POST,
  HttpMethod.enum.GET,
  HttpMethod.enum.PUT,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const getServerKey = () => getConfig().push?.vapidPublicKey ?? ''

const readBody = async (
  req: Parameters<typeof getRequestBody>[0]
): Promise<Record<string, unknown> | null> => {
  try {
    return await getRequestBody(req)
  } catch {
    return null
  }
}

// POST /api/v1/push/subscription — subscribe to push notifications.
export const POST = traceApiRoute(
  'pushSubscriptionCreate',
  OAuthGuard([Scope.enum.push], async (req, { currentActor, database }) => {
    const body = await readBody(req)
    const parsed = body ? parseSubscribeInput(body) : null
    if (!parsed) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Validation failed' },
        responseStatusCode: 422
      })
    }

    const subscription = await database.createPushSubscription({
      actorId: currentActor.id,
      endpoint: parsed.endpoint,
      p256dh: parsed.p256dh,
      auth: parsed.auth,
      alerts: parsed.alerts,
      policy: parsed.policy,
      standard: parsed.standard
    })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: toWebPushSubscription(subscription, getServerKey())
    })
  })
)

// GET /api/v1/push/subscription — retrieve the current subscription.
export const GET = traceApiRoute(
  'pushSubscriptionGet',
  OAuthGuard([Scope.enum.push], async (req, { currentActor, database }) => {
    const subscription = await database.getPushSubscriptionForActor({
      actorId: currentActor.id
    })
    if (!subscription) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })
    }

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: toWebPushSubscription(subscription, getServerKey())
    })
  })
)

// PUT /api/v1/push/subscription — update notification preferences.
export const PUT = traceApiRoute(
  'pushSubscriptionUpdate',
  OAuthGuard([Scope.enum.push], async (req, { currentActor, database }) => {
    const body = (await readBody(req)) ?? {}
    const subscription = await database.updatePushSubscription({
      actorId: currentActor.id,
      alerts: parseAlertsInput(body),
      policy: parsePolicyInput(body)
    })
    if (!subscription) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })
    }

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: toWebPushSubscription(subscription, getServerKey())
    })
  })
)

// DELETE /api/v1/push/subscription — remove the current subscription.
export const DELETE = traceApiRoute(
  'pushSubscriptionDelete',
  OAuthGuard([Scope.enum.push], async (req, { currentActor, database }) => {
    const subscription = await database.getPushSubscriptionForActor({
      actorId: currentActor.id
    })
    if (subscription) {
      await database.deletePushSubscription({
        endpoint: subscription.endpoint,
        actorId: currentActor.id
      })
    }

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: {}
    })
  })
)
