import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_501, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// https://docs.joinmastodon.org/methods/statuses/#translate
// Translation is not configured on this server (configuration.translation.enabled
// is false in /api/v2/instance). Return 501 so clients hide or disable the
// Translate action instead of showing a broken result.
export const POST = traceApiRoute(
  'translateStatus',
  OAuthGuard([Scope.enum.read], async (req) => {
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: ERROR_501,
      responseStatusCode: 501
    })
  })
)
