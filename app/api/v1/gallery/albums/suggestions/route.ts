import {
  albumRateLimited,
  trySuggestionRead
} from '@/lib/services/gallery/galleryAlbumRouteSupport'
import { GalleryAlbumSuggestionsQuery } from '@/lib/services/gallery/galleryAlbumSuggestionRequests'
import { getGalleryAlbumSuggestions } from '@/lib/services/gallery/galleryAlbumSuggestions'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_422, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

// GET /api/v1/gallery/albums/suggestions?time_zone= — album suggestions for the
// signed-in owner: trips (photos with no gap of more than three days), species
// series (five or more photos) and days with a recorded fitness activity. They
// are computed on every call from the owner's own gallery and never stored; one
// that an existing album already covers is left out. Titles name a place only
// when the public view shows it for every photo of the group, and counts come
// from the public projection. Owner only, and limited to 20 reads a minute.
// `time_zone` is the viewer's IANA zone, for which local day an activity is on.
export const GET = traceApiRoute(
  'getGalleryAlbumSuggestions',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, { database, currentActor }) => {
      const query = GalleryAlbumSuggestionsQuery.safeParse(
        Object.fromEntries(new URL(req.url).searchParams.entries())
      )
      if (!query.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }
      if (!trySuggestionRead(currentActor.id)) {
        return albumRateLimited(req, CORS_HEADERS)
      }

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: await getGalleryAlbumSuggestions({
          database,
          owner: currentActor,
          timeZone: query.data.time_zone
        })
      })
    },
    guardOptions
  )
)
