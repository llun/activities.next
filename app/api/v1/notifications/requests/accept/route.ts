import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { addAcceptedSenders } from '@/lib/services/notifications/evaluateNotificationPolicy'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_422,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// Mastodon sends ids under `id[]` (array) or `id` (single string or array).
const normalizeIds = (v: string | string[] | undefined) =>
  v === undefined ? [] : Array.isArray(v) ? v : [v]

const BulkBody = z
  .object({
    id: z.union([z.string(), z.array(z.string())]).optional(),
    'id[]': z.union([z.string(), z.array(z.string())]).optional()
  })
  .transform((value) => normalizeIds(value.id ?? value['id[]']))

export const POST = traceApiRoute(
  'acceptNotificationRequests',
  OAuthGuard([Scope.enum.write], async (req, { currentActor }) => {
    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }

    let rawBody: unknown
    try {
      rawBody = await req.json()
    } catch {
      const formData = await req.formData().catch(() => null)
      if (formData) {
        const ids = formData.getAll('id[]')
        const idSingle = formData.get('id')
        rawBody =
          ids.length > 0 ? { 'id[]': ids } : idSingle ? { id: idSingle } : {}
      } else {
        rawBody = {}
      }
    }
    const parsed = BulkBody.safeParse(rawBody)
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: 422
      })
    }

    const sourceActorIds = parsed.data.map((id) => idToUrl(id))
    await Promise.all([
      database.acceptNotificationRequests({
        actorId: currentActor.id,
        sourceActorIds
      }),
      addAcceptedSenders(database, currentActor.id, sourceActorIds)
    ])

    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
  })
)
