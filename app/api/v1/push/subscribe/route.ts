import { z } from 'zod'

import { ALL_PUSH_ALERTS_ENABLED } from '@/lib/database/sql/pushSubscription'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { apiErrorResponse, apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const SubscribeRequest = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string()
  })
})

const UnsubscribeRequest = z.object({
  endpoint: z.string().url()
})

export const POST = traceApiRoute(
  'pushSubscribe',
  OAuthGuard([Scope.enum.push], async (req, { currentActor, database }) => {
    let body
    try {
      body = await req.json()
    } catch {
      return apiErrorResponse(400)
    }

    const parsed = SubscribeRequest.safeParse(body)
    if (!parsed.success) {
      return apiErrorResponse(400)
    }

    const subscription = await database.createPushSubscription({
      actorId: currentActor.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      // The legacy route has no per-type alert concept; enable every alert so
      // these subscriptions keep receiving all notifications once delivery
      // honors per-subscription alerts (gating stays at actor-level settings).
      alerts: ALL_PUSH_ALERTS_ENABLED,
      // These subscriptions come from the browser PushManager and were always
      // delivered with the standard `aes128gcm` encoding; mark them `standard`
      // so delivery keeps using it now that encoding follows this flag.
      standard: true
    })

    return apiResponse({
      req,
      allowedMethods: ['POST'],
      data: { id: subscription.id }
    })
  })
)

export const DELETE = traceApiRoute(
  'pushUnsubscribe',
  OAuthGuard([Scope.enum.push], async (req, { currentActor, database }) => {
    let body
    try {
      body = await req.json()
    } catch {
      return apiErrorResponse(400)
    }

    const parsed = UnsubscribeRequest.safeParse(body)
    if (!parsed.success) {
      return apiErrorResponse(400)
    }

    await database.deletePushSubscription({
      endpoint: parsed.data.endpoint,
      actorId: currentActor.id
    })

    return apiResponse({
      req,
      allowedMethods: ['DELETE'],
      data: { status: 'OK' }
    })
  })
)
