import { getDatabase } from '@/lib/database'
import { Scope } from '@/lib/database/types/oauth'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const POST = traceApiRoute(
  'dismissNotification',
  OAuthGuard<Params>(
    [Scope.enum.write],
    async (req, { currentActor, params }) => {
      const database = getDatabase()
      if (!database) {
        return apiErrorResponse(500)
      }

      const id = (await params).id

      // Verify ownership
      const notifications = await database.getNotifications({
        actorId: currentActor.id,
        ids: [id],
        limit: 1
      })

      if (notifications.length === 0) {
        return apiErrorResponse(404)
      }

      await database.deleteNotification(id)

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {}
      })
    }
  )
)
