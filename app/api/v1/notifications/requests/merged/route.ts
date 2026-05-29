import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// Accepting a notification request resolves synchronously here (it just clears
// the filtered flag), so merges are always complete by the time this is polled.
export const GET = traceApiRoute(
  'getNotificationRequestsMerged',
  OAuthGuard([Scope.enum.read], async (req) =>
    apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { merged: true }
    })
  )
)
