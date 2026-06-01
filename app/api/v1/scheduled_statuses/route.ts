import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// https://docs.joinmastodon.org/methods/scheduled_statuses/
// Scheduling is not supported on this server (statuses are published
// immediately), so there are never any scheduled statuses. Returning an empty
// list lets clients show the "Scheduled" view without error. Mastodon scopes
// this with read:statuses (matching the /:id route).
export const GET = traceApiRoute(
  'getScheduledStatuses',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req) => {
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: [] })
    }
  )
)
