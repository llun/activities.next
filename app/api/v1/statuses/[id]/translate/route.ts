import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { HTTP_STATUS, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// https://docs.joinmastodon.org/methods/statuses/#translate
// Translation is not configured on this server (configuration.translation.enabled
// is false in /api/v2/instance). Mastodon returns 503 when a translation cannot
// be produced, so clients disable/hide the Translate action gracefully.
export const POST = traceApiRoute(
  'translateStatus',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req) => {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Translation is not supported on this server' },
        responseStatusCode: HTTP_STATUS.SERVICE_UNAVAILABLE
      })
    }
  )
)
