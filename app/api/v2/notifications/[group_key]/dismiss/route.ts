import { getDatabase } from '@/lib/database'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_500, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  group_key: string
}

export const POST = traceApiRoute(
  'dismissGroupedNotification',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:notifications']],
    async (req, { currentActor, params }) => {
      const database = getDatabase()
      if (!database) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_500,
          responseStatusCode: 500
        })
      }

      const rawGroupKey = (await params).group_key
      const groupKey = rawGroupKey.startsWith('ungrouped-')
        ? rawGroupKey.slice('ungrouped-'.length)
        : rawGroupKey
      await database.dismissNotificationGroup({
        actorId: currentActor.id,
        groupKey
      })

      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
    }
  )
)
