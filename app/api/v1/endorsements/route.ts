import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// https://docs.joinmastodon.org/methods/endorsements/
// Profile endorsements (featured accounts) are not supported; return an empty
// list so clients render the profile without error. Mastodon scopes this with
// read:accounts.
export const GET = traceApiRoute(
  'getEndorsements',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:accounts']],
    async (req) => {
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: [] })
    }
  )
)
