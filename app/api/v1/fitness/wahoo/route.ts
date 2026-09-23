import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { withImportLock } from '@/lib/services/fitness-files/importLock'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { getQueue } from '@/lib/services/queue'
import { Visibility } from '@/lib/types/mastodon/visibility'
import { apiErrorResponse, apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const SettingsSchema = z.object({
  clientId: z.string().trim().min(1).max(255).optional(),
  clientSecret: z.string().trim().max(2048).optional(),
  webhookToken: z
    .string()
    .trim()
    .max(255)
    .refine((value) => value.length === 0 || value.length >= 8)
    .optional(),
  environment: z.enum(['sandbox', 'production']).optional(),
  defaultVisibility: Visibility.optional()
})

const getOrigin = () => {
  const host = getConfig().host
  return `${host.startsWith('localhost') ? 'http' : 'https'}://${host}`
}

export const GET = traceApiRoute(
  'getWahooSettings',
  AuthenticatedGuard(async (req, { currentActor, database }) => {
    const settings = await database.getFitnessSettings({
      actorId: currentActor.id,
      serviceType: 'wahoo'
    })
    const origin = getOrigin()
    return apiResponse({
      req,
      allowedMethods: [],
      data: {
        configured: Boolean(settings?.clientId),
        actorId: currentActor.id,
        actorHandle: `@${currentActor.username}@${currentActor.domain}`,
        clientId: settings?.clientId,
        hasClientSecret: Boolean(settings?.clientSecret),
        hasWebhookToken: Boolean(settings?.webhookToken),
        connected: Boolean(settings?.accessToken && settings.providerUserId),
        environment: settings?.providerEnvironment ?? 'sandbox',
        defaultVisibility: settings?.defaultVisibility ?? 'private',
        callbackUrl: `${origin}/api/v1/settings/fitness/wahoo/callback`,
        webhookUrl: `${origin}/api/v1/webhooks/wahoo/`,
        automaticImportAvailable: !getQueue().runsInline,
        providerUserId: settings?.providerUserId,
        lastWebhookAt: settings?.lastWebhookAt
          ? new Date(settings.lastWebhookAt).toISOString()
          : undefined,
        lastImportAt: settings?.lastImportAt
          ? new Date(settings.lastImportAt).toISOString()
          : undefined,
        lastError: settings?.connectionError
      }
    })
  })
)

export const POST = traceApiRoute(
  'saveWahooSettings',
  AuthenticatedGuard(async (req, { currentActor, database }) => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return apiErrorResponse(400)
    }
    const parsed = SettingsSchema.safeParse(body)
    if (!parsed.success) return apiErrorResponse(422)

    const existing = await database.getFitnessSettings({
      actorId: currentActor.id,
      serviceType: 'wahoo'
    })
    const {
      clientId,
      clientSecret,
      webhookToken,
      environment,
      defaultVisibility
    } = parsed.data
    const nextClientId = clientId ?? existing?.clientId
    const nextClientSecret = clientSecret || existing?.clientSecret
    const nextWebhookToken = webhookToken || existing?.webhookToken

    if (!nextClientId || !nextClientSecret || !nextWebhookToken) {
      return apiResponse({
        req,
        allowedMethods: [],
        data: {
          error: 'Client ID, client secret and webhook token are required'
        },
        responseStatusCode: 400
      })
    }

    if (existing) {
      const credentialsChanged =
        (clientId !== undefined && clientId !== existing.clientId) ||
        (Boolean(clientSecret) && clientSecret !== existing.clientSecret)
      await database.updateFitnessSettings({
        id: existing.id,
        clientId: nextClientId,
        ...(clientSecret ? { clientSecret } : {}),
        ...(webhookToken ? { webhookToken } : {}),
        providerEnvironment:
          environment ?? existing.providerEnvironment ?? 'sandbox',
        defaultVisibility:
          defaultVisibility ?? existing.defaultVisibility ?? 'private',
        ...(credentialsChanged
          ? {
              accessToken: null,
              refreshToken: null,
              tokenExpiresAt: null,
              providerUserId: null,
              grantedScopes: null,
              oauthState: null,
              oauthStateExpiry: null
            }
          : {})
      })
    } else {
      await database.createFitnessSettings({
        actorId: currentActor.id,
        serviceType: 'wahoo',
        clientId: nextClientId,
        clientSecret: nextClientSecret,
        webhookToken: nextWebhookToken,
        providerEnvironment: environment ?? 'sandbox',
        defaultVisibility: defaultVisibility ?? 'private'
      })
    }

    return apiResponse({
      req,
      allowedMethods: [],
      data: { success: true }
    })
  })
)

export const DELETE = traceApiRoute(
  'deleteWahooSettings',
  AuthenticatedGuard(async (req, { currentActor, database }) => {
    try {
      await withImportLock(
        database,
        `fitness-import:${currentActor.id}`,
        async () => {
          await database.cancelWahooHistoryImportsByActor(currentActor.id)
          await database.deleteFitnessSettings({
            actorId: currentActor.id,
            serviceType: 'wahoo'
          })
        },
        { failOnTimeout: true, ttlMs: 5 * 60 * 1000 }
      )
    } catch {
      return apiErrorResponse(503)
    }
    return apiResponse({ req, allowedMethods: [], data: { success: true } })
  })
)
