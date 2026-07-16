import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import {
  OAuthGuard,
  corsErrorResponse,
  getTokenFromHeader
} from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { getRequestBody } from '@/lib/utils/getRequestBody'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

import {
  hasInvalidPolicy,
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

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

// Mastodon answers a missing push subscription with `{ error: 'Record not
// found' }` (HTTP 404), not the generic `{ status: 'Not Found' }`. Mastodon-API
// clients rely on that: Phanpy treats "no subscription yet" as the expected
// state only when the error *message* matches `/(not found|unknown)/i`. masto.js
// derives that message from the body's `error` field, so a `{ status: … }` body
// leaves the message empty, the check misses, and opening Settings surfaces a
// `{"statusCode":404,"additionalProperties":{"status":"Not Found"}}` toast. Emit
// the Mastodon shape so the message carries "Record not found".
const RECORD_NOT_FOUND = { error: 'Record not found' }

// Web Push requires VAPID keys; without `config.push` configured the server has
// no `server_key` to hand out and `pushNotification` skips delivery entirely,
// so a stored subscription would silently never receive notifications. Return
// 404 instead, matching `app/api/v1/push/vapid-key/route.ts`.
const requirePushConfig = (req: NextRequest): Response | null => {
  const config = getConfig()
  if (config.push) return null
  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: RECORD_NOT_FOUND,
    responseStatusCode: 404
  })
}

const getServerKey = () => getConfig().push?.vapidPublicKey ?? ''

// Mastodon scopes push subscriptions per access token (one subscription per
// token), so GET/PUT/DELETE must operate on the requesting token's own row —
// not the actor's most-recent one — or multiple clients (web, iOS, …) end up
// reading and deleting each other's subscriptions. Undefined for web-session
// requests, which are scoped to the actor's tokenless subscriptions instead.
const getAccessToken = (req: NextRequest): string | undefined =>
  getTokenFromHeader(req.headers.get('Authorization')) ?? undefined

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
  OAuthGuard(
    [Scope.enum.push],
    async (req, { currentActor, database }) => {
      const pushDisabled = requirePushConfig(req)
      if (pushDisabled) return pushDisabled

      const body = await readBody(req)
      const parsed = body ? parseSubscribeInput(body) : null
      if (!parsed || (body && hasInvalidPolicy(body))) {
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
        standard: parsed.standard,
        // Store the bearer token so the Mastodon Web Push payload can include
        // it as `access_token` and so GET/PUT/DELETE can find this token's
        // subscription. Null for web-session requests (no bearer token).
        accessToken: getAccessToken(req)
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: toWebPushSubscription(subscription, getServerKey())
      })
    },
    guardOptions
  )
)

// GET /api/v1/push/subscription — retrieve the current subscription.
export const GET = traceApiRoute(
  'pushSubscriptionGet',
  OAuthGuard(
    [Scope.enum.push],
    async (req, { currentActor, database }) => {
      const pushDisabled = requirePushConfig(req)
      if (pushDisabled) return pushDisabled

      const subscription = await database.getPushSubscriptionForActor({
        actorId: currentActor.id,
        accessToken: getAccessToken(req)
      })
      if (!subscription) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: RECORD_NOT_FOUND,
          responseStatusCode: 404
        })
      }

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: toWebPushSubscription(subscription, getServerKey())
      })
    },
    guardOptions
  )
)

// PUT /api/v1/push/subscription — update notification preferences.
export const PUT = traceApiRoute(
  'pushSubscriptionUpdate',
  OAuthGuard(
    [Scope.enum.push],
    async (req, { currentActor, database }) => {
      const pushDisabled = requirePushConfig(req)
      if (pushDisabled) return pushDisabled

      const body = await readBody(req)
      if (!body || hasInvalidPolicy(body)) {
        // A malformed/unreadable body, or a present-but-invalid policy, means
        // the submitted preferences can't be applied — fail loudly instead of
        // reporting a no-op success, matching the POST path.
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Validation failed' },
          responseStatusCode: 422
        })
      }
      // PUT replaces the alert set, so pass the parsed alerts through as-is
      // (omitted flags become false in the DB layer). When the request carries
      // no alert keys at all, pass `undefined` so a policy-only update does not
      // wipe the stored alerts.
      const parsedAlerts = parseAlertsInput(body)
      const subscription = await database.updatePushSubscription({
        actorId: currentActor.id,
        alerts: Object.keys(parsedAlerts).length > 0 ? parsedAlerts : undefined,
        policy: parsePolicyInput(body),
        accessToken: getAccessToken(req)
      })
      if (!subscription) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: RECORD_NOT_FOUND,
          responseStatusCode: 404
        })
      }

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: toWebPushSubscription(subscription, getServerKey())
      })
    },
    guardOptions
  )
)

// DELETE /api/v1/push/subscription — remove the current subscription.
export const DELETE = traceApiRoute(
  'pushSubscriptionDelete',
  OAuthGuard(
    [Scope.enum.push],
    async (req, { currentActor, database }) => {
      const subscription = await database.getPushSubscriptionForActor({
        actorId: currentActor.id,
        accessToken: getAccessToken(req)
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
    },
    guardOptions
  )
)
