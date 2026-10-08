import {
  getGalleryAlbumCard,
  getGalleryAlbumDetail
} from '@/lib/services/gallery/galleryAlbumQueries'
import {
  GalleryAlbumItemsQuery,
  UpdateGalleryAlbumRequest
} from '@/lib/services/gallery/galleryAlbumRequests'
import {
  albumRateLimited,
  readJsonBody,
  tryAlbumWrite
} from '@/lib/services/gallery/galleryAlbumRouteSupport'
import { OWNER_GALLERY_AUDIENCE } from '@/lib/services/gallery/galleryAudience'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { clampedLimit } from '@/lib/utils/clampedLimit'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  DEFAULT_200,
  ERROR_404,
  ERROR_422,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.PATCH,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

interface Params {
  id: string
}

// Every method is scoped to the signed-in actor, so a missing album and
// somebody else's album are the same 404.
const notFound = (req: Parameters<typeof apiResponse>[0]['req']) =>
  apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: ERROR_404,
    responseStatusCode: 404
  })

const DetailQuery = GalleryAlbumItemsQuery.pick({ sort: true }).extend({
  limit: clampedLimit(60, 30)
})

// GET /api/v1/gallery/albums/:id — the owner's album page: the album, its
// facts line as a visitor would see it, the owner's species chips and the first
// page of photos.
export const GET = traceApiRoute(
  'getGalleryAlbum',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const query = DetailQuery.safeParse(
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

      const detail = await getGalleryAlbumDetail({
        database,
        owner: currentActor,
        albumId: id,
        limit: query.data.limit,
        sort: query.data.sort
      })
      if (!detail) return notFound(req)

      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: detail })
    },
    guardOptions
  )
)

// PATCH /api/v1/gallery/albums/:id — edits the given fields of an album.
// `cover_media_id` must be one of the album's own photos (422 otherwise), and
// `null` clears the choice.
export const PATCH = traceApiRoute(
  'updateGalleryAlbum',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:media']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const existing = await database.getGalleryAlbum({
        id,
        actorId: currentActor.id,
        audience: OWNER_GALLERY_AUDIENCE
      })
      if (!existing) return notFound(req)

      const parsed = UpdateGalleryAlbumRequest.safeParse(
        await readJsonBody(req)
      )
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }
      if (!tryAlbumWrite(currentActor.id)) {
        return albumRateLimited(req, CORS_HEADERS)
      }

      const { title, description, visibility, sort_order, cover_media_id } =
        parsed.data
      const result = await database.updateGalleryAlbum({
        id,
        actorId: currentActor.id,
        title,
        description,
        visibility,
        sortOrder: sort_order,
        coverMediaId: cover_media_id
      })
      if (result.status === 'not-found') return notFound(req)
      if (result.status === 'invalid-cover') {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'The cover must be a photo in the album' },
          responseStatusCode: 422
        })
      }

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          album: await getGalleryAlbumCard({
            database,
            owner: currentActor,
            audience: OWNER_GALLERY_AUDIENCE,
            albumId: id
          })
        }
      })
    },
    guardOptions
  )
)

// DELETE /api/v1/gallery/albums/:id — deletes the album and its list of
// photos. The photos and their posts stay.
export const DELETE = traceApiRoute(
  'deleteGalleryAlbum',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:media']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const existing = await database.getGalleryAlbum({
        id,
        actorId: currentActor.id,
        audience: OWNER_GALLERY_AUDIENCE
      })
      if (!existing) return notFound(req)
      if (!tryAlbumWrite(currentActor.id)) {
        return albumRateLimited(req, CORS_HEADERS)
      }

      const deleted = await database.deleteGalleryAlbum({
        id,
        actorId: currentActor.id
      })
      if (!deleted) return notFound(req)

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: DEFAULT_200
      })
    },
    guardOptions
  )
)
