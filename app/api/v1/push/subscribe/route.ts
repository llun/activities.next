import { z } from 'zod'

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
      auth: parsed.data.keys.auth
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
