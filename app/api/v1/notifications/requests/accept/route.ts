import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
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

// Mastodon sends the account ids under `id[]`; accept either `id` or `id[]`.
const BulkBody = z
  .object({
    id: z.array(z.string()).optional(),
    'id[]': z.array(z.string()).optional()
  })
  .transform((value) => value.id ?? value['id[]'] ?? [])

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

    const body = await req.json().catch(() => null)
    const parsed = BulkBody.safeParse(body)
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: 422
      })
    }

    await database.acceptNotificationRequests({
      actorId: currentActor.id,
      sourceActorIds: parsed.data.map((id) => idToUrl(id))
    })

    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
  })
)
