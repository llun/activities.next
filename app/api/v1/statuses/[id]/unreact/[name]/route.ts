import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import {
  reactionRouteAttributes,
  reactionWriteHandler
} from '@/lib/services/reactions/reactionRouteHandlers'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

// glitch-soc dialect — a thin alias over the same service as the Pleroma route,
// so the two surfaces can never disagree. Not core Mastodon API.
const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
  name: string
}

export const POST = traceApiRoute(
  'unreactStatus',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:favourites']],
    reactionWriteHandler('unreact', CORS_HEADERS),
    { errorResponse: corsErrorResponse(CORS_HEADERS) }
  ),
  { addAttributes: reactionRouteAttributes }
)
