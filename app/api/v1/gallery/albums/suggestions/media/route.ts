import {
  albumRateLimited,
  trySuggestionMediaRead
} from '@/lib/services/gallery/galleryAlbumRouteSupport'
import { GalleryAlbumSuggestionMediaQuery } from '@/lib/services/gallery/galleryAlbumSuggestionRequests'
import { getGallerySuggestionMedia } from '@/lib/services/gallery/galleryAlbumSuggestions'
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

// GET /api/v1/gallery/albums/suggestions/media?media_ids=1,2,3 — the owner's
// own photos behind up to 100 media ids (a suggestion's `mediaIds`), in the
// order asked, so the dialog can show a suggestion's photos a page at a time.
// An id that is not the owner's gallery media (another account's, an unposted
// upload, a deleted post's photo) is left out, not an error. Owner only.
export const GET = traceApiRoute(
  'getGalleryAlbumSuggestionMedia',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, { database, currentActor }) => {
      const query = GalleryAlbumSuggestionMediaQuery.safeParse(
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
      if (!trySuggestionMediaRead(currentActor.id)) {
        return albumRateLimited(req, CORS_HEADERS)
      }

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: await getGallerySuggestionMedia({
          database,
          owner: currentActor,
          mediaIds: query.data.media_ids
        })
      })
    },
    guardOptions
  )
)
