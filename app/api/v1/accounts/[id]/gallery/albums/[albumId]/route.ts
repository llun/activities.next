import { getGalleryAlbumView } from '@/lib/services/gallery/galleryAlbumQueries'
import { GalleryAlbumItemsQuery } from '@/lib/services/gallery/galleryAlbumRequests'
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
import { clampedLimit } from '@/lib/utils/clampedLimit'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_400,
  ERROR_404,
  ERROR_422,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
  albumId: string
}

// A stored album id is a UUID; anything much longer cannot be one, so it is
// answered like any other id that names nothing.
const MAX_ALBUM_ID_LENGTH = 128

const AlbumViewQuery = GalleryAlbumItemsQuery.extend({
  limit: clampedLimit(60, 30)
})

// GET /api/v1/accounts/:id/gallery/albums/:albumId — an album as the
// requesting viewer may open it, with a page of its photos
// (`?max_id&limit&sort&subject`). A private album, a missing one, one of
// another account and one with no photo this viewer can see are the same 404,
// so the response never says which of them it was.
export const GET = traceApiRoute(
  'getAccountGalleryAlbum',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, context) => {
      const { database, currentActor, params } = context

      if (!tryAlbumRead(getAlbumReadKey(req, currentActor))) {
        return albumRateLimited(req, CORS_HEADERS)
      }

      const { id: encodedAccountId, albumId } = await params
      if (!encodedAccountId || !albumId) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }

      const notFound = () =>
        apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })

      const resolved = await resolveGalleryAccount({
        database,
        encodedAccountId,
        currentActor
      })
      if (!resolved || albumId.length > MAX_ALBUM_ID_LENGTH) return notFound()
      const { owner, audience } = resolved

      // The 404 comes before the query is looked at, so a malformed query is
      // only ever reported for an album this viewer can open and a probe learns
      // nothing from a 422 either.
      const openable = await database.getGalleryAlbum({
        id: albumId,
        actorId: owner.id,
        audience
      })
      if (!openable) return notFound()

      const parsed = AlbumViewQuery.safeParse(
        Object.fromEntries(new URL(req.url).searchParams.entries())
      )
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }

      const view = await getGalleryAlbumView({
        database,
        owner,
        audience,
        albumId,
        sort: parsed.data.sort,
        maxId: parsed.data.max_id,
        limit: parsed.data.limit,
        subjectKey: parsed.data.subject
      })
      if (!view) return notFound()

      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: view })
    },
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
