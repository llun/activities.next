import {
  getGalleryAlbumCard,
  getGalleryAlbumPage
} from '@/lib/services/gallery/galleryAlbumQueries'
import {
  GalleryAlbumItemsQuery,
  GalleryAlbumItemsRequest
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
import { MAX_GALLERY_ALBUM_ITEMS } from '@/lib/types/database/galleryAlbums'
import { Scope } from '@/lib/types/database/operations'
import { clampedLimit } from '@/lib/utils/clampedLimit'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_404,
  ERROR_422,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

interface Params {
  id: string
}

const notFound = (req: Parameters<typeof apiResponse>[0]['req']) =>
  apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: ERROR_404,
    responseStatusCode: 404
  })

const invalid = (req: Parameters<typeof apiResponse>[0]['req']) =>
  apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: ERROR_422,
    responseStatusCode: 422
  })

const PageQuery = GalleryAlbumItemsQuery.extend({
  limit: clampedLimit(60, 30)
})

// GET /api/v1/gallery/albums/:id/items?max_id&limit&sort&subject — a page of
// the album's photos in `sort` order (the album's own order by default), with
// the cursor of the next page as `nextMaxId`. `subject` is a species key from
// the album page's chips. Same 404 as a missing album for somebody else's.
export const GET = traceApiRoute(
  'getGalleryAlbumItems',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const album = await database.getGalleryAlbum({
        id,
        actorId: currentActor.id,
        audience: OWNER_GALLERY_AUDIENCE
      })
      if (!album) return notFound(req)

      const query = PageQuery.safeParse(
        Object.fromEntries(new URL(req.url).searchParams.entries())
      )
      if (!query.success) return invalid(req)

      const page = await getGalleryAlbumPage({
        database,
        owner: currentActor,
        audience: OWNER_GALLERY_AUDIENCE,
        albumId: id,
        sort: query.data.sort ?? album.sortOrder,
        maxId: query.data.max_id,
        limit: query.data.limit,
        subjectKey: query.data.subject
      })
      if (!page) return notFound(req)

      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: page })
    },
    guardOptions
  )
)

// POST /api/v1/gallery/albums/:id/items — adds up to 100 of the owner's own
// gallery photos. Anything else (another account's media, a missing id, an
// unposted upload, a photo outside the gallery) is ignored and reported as
// `skipped`; ids already in the album are `existing`. All or nothing: past
// 2000 photos in the album it answers 422 and adds none.
export const POST = traceApiRoute(
  'addGalleryAlbumItems',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:media']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const album = await database.getGalleryAlbum({
        id,
        actorId: currentActor.id,
        audience: OWNER_GALLERY_AUDIENCE
      })
      if (!album) return notFound(req)

      const parsed = GalleryAlbumItemsRequest.safeParse(await readJsonBody(req))
      if (!parsed.success) return invalid(req)
      if (!tryAlbumWrite(currentActor.id)) {
        return albumRateLimited(req, CORS_HEADERS)
      }

      const result = await database.addGalleryAlbumItems({
        albumId: id,
        actorId: currentActor.id,
        mediaIds: parsed.data.media_ids,
        limit: MAX_GALLERY_ALBUM_ITEMS
      })
      if (result.status === 'not-found') return notFound(req)
      if (result.status === 'limit-reached') {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Too many photos in this album' },
          responseStatusCode: 422
        })
      }

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          added: result.added,
          existing: result.existing,
          skipped: result.skipped,
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

// DELETE /api/v1/gallery/albums/:id/items — removes up to 100 photos from the
// album. The photos and their posts are never deleted. An id that is not in
// the album is ignored.
export const DELETE = traceApiRoute(
  'removeGalleryAlbumItems',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:media']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const album = await database.getGalleryAlbum({
        id,
        actorId: currentActor.id,
        audience: OWNER_GALLERY_AUDIENCE
      })
      if (!album) return notFound(req)

      const parsed = GalleryAlbumItemsRequest.safeParse(await readJsonBody(req))
      if (!parsed.success) return invalid(req)
      if (!tryAlbumWrite(currentActor.id)) {
        return albumRateLimited(req, CORS_HEADERS)
      }

      const result = await database.removeGalleryAlbumItems({
        albumId: id,
        actorId: currentActor.id,
        mediaIds: parsed.data.media_ids
      })
      if (result.status === 'not-found') return notFound(req)

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          removed: result.removed,
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
