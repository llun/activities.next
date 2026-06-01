import { OptionalOAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// https://docs.joinmastodon.org/methods/trends/#links
// Trending links are not computed on this personal server; return an empty list.
export const GET = traceApiRoute(
  'getTrendingLinks',
  OptionalOAuthGuard([Scope.enum.read], async (req) => {
    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: [] })
  })
)
