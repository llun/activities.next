import { getGalleryAlbumList } from '@/lib/services/gallery/galleryAlbumQueries'
import {
  albumRateLimited,
  getAlbumReadKey,
  tryAlbumRead
} from '@/lib/services/gallery/galleryAlbumRouteSupport'
import { resolveGalleryAccount } from '@/lib/services/gallery/resolveGalleryAccount'
import {
  OptionalOAuthGuard,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_400,
  ERROR_404,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

// GET /api/v1/accounts/:id/gallery/albums — the account's albums as the
// requesting viewer may open them: for anyone but the owner only `public`
// albums with at least one photo that viewer can see, each with its count,
// dates, cover and collage computed from those photos alone. Who the viewer is
// decides both which albums and which photos; the service owns both.
export const GET = traceApiRoute(
  'getAccountGalleryAlbums',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, context) => {
      const { database, currentActor, params } = context

      if (!tryAlbumRead(getAlbumReadKey(req, currentActor))) {
        return albumRateLimited(req, CORS_HEADERS)
      }

      const { id: encodedAccountId } = await params
      if (!encodedAccountId) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }

      const resolved = await resolveGalleryAccount({
        database,
        encodedAccountId,
        currentActor
      })
      if (!resolved) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }
      const { owner, audience } = resolved

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: await getGalleryAlbumList({ database, owner, audience })
      })
    },
    // `matchMode: 'any'` because a token may legally hold `read:statuses`
    // alone, and `errorResponse` so the guard's own rejections carry CORS
    // headers (see the sibling account gallery routes).
    {
      errorResponse: corsErrorResponse(CORS_HEADERS),
      matchMode: 'any'
    }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)
