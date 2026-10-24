import { GalleryAlbumMembershipResponse } from '@/lib/services/gallery/galleryAlbumEntities'
import { GalleryAlbumMembershipRequest } from '@/lib/services/gallery/galleryAlbumRequests'
import { readJsonBody } from '@/lib/services/gallery/galleryAlbumRouteSupport'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_422, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

// POST /api/v1/gallery/albums/membership - owner only by construction:
// the query is scoped to the caller's albums and items. Returns which of
// the caller's albums hold each requested media ID.
export const POST = traceApiRoute(
  'getGalleryAlbumMembership',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, { database, currentActor }) => {
      const parsed = GalleryAlbumMembershipRequest.safeParse(
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

      const sets = await database.getGalleryAlbumItemSets({
        actorId: currentActor.id,
        mediaIds: parsed.data.media_ids
      })

      const data: GalleryAlbumMembershipResponse = {
        albums: sets.map(({ albumId, mediaIds }) => ({
          id: albumId,
          mediaIds
        }))
      }

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data
      })
    },
    guardOptions
  )
)
