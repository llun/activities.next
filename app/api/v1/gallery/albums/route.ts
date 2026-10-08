import {
  getGalleryAlbumCard,
  getGalleryAlbumList
} from '@/lib/services/gallery/galleryAlbumQueries'
import { CreateGalleryAlbumRequest } from '@/lib/services/gallery/galleryAlbumRequests'
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
import {
  MAX_GALLERY_ALBUMS_PER_ACTOR,
  MAX_GALLERY_ALBUM_ITEMS
} from '@/lib/types/database/galleryAlbums'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_422, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

// GET /api/v1/gallery/albums — the signed-in owner's albums, last updated
// first, with counts, dates, cover and collage computed from the photos the
// owner can see, and the number of distinct photos across them. Owner only:
// the visitor side reads another account's albums elsewhere.
export const GET = traceApiRoute(
  'listGalleryAlbums',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, { database, currentActor }) =>
      apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: await getGalleryAlbumList({
          database,
          owner: currentActor,
          audience: OWNER_GALLERY_AUDIENCE
        })
      }),
    guardOptions
  )
)

// POST /api/v1/gallery/albums — creates an album, optionally with its first
// photos (`media_ids`, at most 100; a client with more adds the rest through
// `/items`). The photos are the owner's own gallery media: any other id is
// reported as `skipped`. Past 200 albums it answers 422 and creates nothing.
export const POST = traceApiRoute(
  'createGalleryAlbum',
  OAuthGuardAnyScope(
    [Scope.enum.write, Scope.enum['write:media']],
    async (req, { database, currentActor }) => {
      const parsed = CreateGalleryAlbumRequest.safeParse(
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

      const { title, description, visibility, sort_order, media_ids } =
        parsed.data
      const created = await database.createGalleryAlbumWithinLimit({
        actorId: currentActor.id,
        title,
        description,
        visibility,
        sortOrder: sort_order,
        limit: MAX_GALLERY_ALBUMS_PER_ACTOR
      })
      if (created.status === 'limit-reached') {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Too many albums' },
          responseStatusCode: 422
        })
      }

      let added: string[] = []
      let existing: string[] = []
      let skipped: string[] = []
      if (media_ids) {
        const result = await database.addGalleryAlbumItems({
          albumId: created.album.id,
          actorId: currentActor.id,
          mediaIds: media_ids,
          limit: MAX_GALLERY_ALBUM_ITEMS
        })
        if (result.status === 'added') {
          ;({ added, existing, skipped } = result)
        }
      }

      const album = await getGalleryAlbumCard({
        database,
        owner: currentActor,
        audience: OWNER_GALLERY_AUDIENCE,
        albumId: created.album.id
      })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { album, added, existing, skipped }
      })
    },
    guardOptions
  )
)
