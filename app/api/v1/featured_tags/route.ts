import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// https://docs.joinmastodon.org/methods/featured_tags/
// Featuring hashtags on a profile is not supported on this personal server;
// return an empty list so clients render the profile editor without error.
export const GET = traceApiRoute(
  'getFeaturedTags',
  OAuthGuard([Scope.enum.read], async (req) => {
    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: [] })
  })
)
