import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const DismissBody = z.object({ id: z.string() })

export const POST = traceApiRoute(
  'dismissNotificationByBody',
  OAuthGuard([Scope.enum.write], async (req, { currentActor }) => {
    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Internal Server Error' },
        responseStatusCode: 500
      })
    }

    const body = await req.json()
    const parsed = DismissBody.safeParse(body)
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Bad Request' },
        responseStatusCode: 400
      })
    }

    const { id } = parsed.data

    // Verify ownership
    const notifications = await database.getNotifications({
      actorId: currentActor.id,
      ids: [id],
      limit: 1
    })

    if (notifications.length === 0) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Not Found' },
        responseStatusCode: 404
      })
    }

    await database.deleteNotification(id)

    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
  })
)
