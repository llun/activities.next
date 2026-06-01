import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// https://docs.joinmastodon.org/methods/suggestions/#v2
// Follow suggestions are not generated on this personal server; return an empty
// list. (The deprecated v1 variant is intentionally not implemented.)
export const GET = traceApiRoute(
  'getSuggestions',
  OAuthGuard([Scope.enum.read], async (req) => {
    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: [] })
  })
)
