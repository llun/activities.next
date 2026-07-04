import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
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
  OAuthGuardAnyScope(
    [Scope.enum.write, Scope.enum['write:notifications']],
    async (req, { currentActor }) => {
      const database = getDatabase()
      if (!database) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_500,
          responseStatusCode: 500
        })
      }

      const contentType = req.headers.get('content-type') ?? ''
      let rawBody: unknown
      if (
        contentType.includes('application/x-www-form-urlencoded') ||
        contentType.includes('multipart/form-data')
      ) {
        const formData = await req.formData().catch(() => null)
        if (formData) {
          const ids = formData.getAll('id[]')
          const idSingle = formData.get('id')
          rawBody =
            ids.length > 0 ? { 'id[]': ids } : idSingle ? { id: idSingle } : {}
        } else {
          rawBody = {}
        }
      } else {
        rawBody = await req.json().catch(() => ({}))
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

      const allSourceActorIds = parsed.data.map((id) => idToUrl(id))
      // Only add senders that have an actual pending request to prevent arbitrary
      // allowlisting of accounts the user never intentionally accepted.
      const pendingRequests = await Promise.all(
        allSourceActorIds.map((sourceActorId) =>
          database.getNotificationRequest({
            actorId: currentActor.id,
            sourceActorId
          })
        )
      )
      const sourceActorIds = allSourceActorIds.filter(
        (_, i) => pendingRequests[i] !== null
      )
      await Promise.all([
        database.acceptNotificationRequests({
          actorId: currentActor.id,
          sourceActorIds
        }),
        addAcceptedSenders(database, currentActor.id, sourceActorIds)
      ])

      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
    }
  )
)
