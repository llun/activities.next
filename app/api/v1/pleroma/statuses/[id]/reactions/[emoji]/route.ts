import {
  OAuthGuardAnyScope,
  OptionalOAuthGuard,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { getStatusReactionList } from '@/lib/services/reactions/getStatusReactionList'
import {
  reactionRouteAttributes,
  reactionWriteHandler
} from '@/lib/services/reactions/reactionRouteHandlers'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_404, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

// Pleroma/Akkoma dialect — the primary reaction surface, and the one with real
// deployed client support (Husky, the Megalodon family). Not core Mastodon API.
const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.PUT,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }
const WRITE_SCOPES = [Scope.enum.write, Scope.enum['write:favourites']]

interface Params {
  id: string
  emoji: string
}

export const GET = traceApiRoute(
  'getStatusReactionsByEmoji',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, { database, currentActor, params }) => {
      const { id, emoji } = await params
      const reactions = await getStatusReactionList({
        database,
        currentActor,
        statusId: idToUrl(id),
        name: emoji
      })
      if (!reactions) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: reactions })
    },
    // `any`, so a token holding only the granular `read:statuses` is accepted;
    // the guard otherwise defaults to requiring every listed scope.
    { ...guardOptions, matchMode: 'any' }
  ),
  { addAttributes: reactionRouteAttributes }
)

export const PUT = traceApiRoute(
  'addStatusReaction',
  OAuthGuardAnyScope<Params>(
    WRITE_SCOPES,
    reactionWriteHandler('react', CORS_HEADERS),
    guardOptions
  ),
  { addAttributes: reactionRouteAttributes }
)

export const DELETE = traceApiRoute(
  'removeStatusReaction',
  OAuthGuardAnyScope<Params>(
    WRITE_SCOPES,
    reactionWriteHandler('unreact', CORS_HEADERS),
    guardOptions
  ),
  { addAttributes: reactionRouteAttributes }
)
