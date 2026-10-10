import { readJsonBody } from '@/lib/services/gallery/galleryAlbumRouteSupport'
import { AddGalleryMediaRequest } from '@/lib/services/gallery/galleryRequests'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_404,
  ERROR_422,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

// POST /api/v1/gallery/media — keeps uploaded media in the signed-in owner's
// gallery without a post ("Add to gallery"). `media_ids` are ids that
// `POST /api/v2/media` answered with. Only the caller's own media that no
// status uses and whose upload has finished is added; any other id is skipped
// and left out of `media_ids` in the answer. Adding again changes nothing.
// Nothing is federated: until a post uses it, only the owner can see the media.
// 404 when none of the ids could be added.
export const POST = traceApiRoute(
  'addGalleryMedia',
  OAuthGuardAnyScope(
    [Scope.enum.write, Scope.enum['write:media']],
    async (req, { database, currentActor }) => {
      const parsed = AddGalleryMediaRequest.safeParse(await readJsonBody(req))
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }

      // The gallery is the actor's: only the media of the actor the token acts
      // as, that no status uses, and whose upload has finished (a file still
      // being sent to object storage is not there to keep yet).
      const medias = await database.getUnattachedMedia({
        actorId: currentActor.id,
        mediaIds: parsed.data.media_ids
      })
      const eligible = medias
        .filter((media) => media.original.metaData.upload?.state !== 'pending')
        .map((media) => media.id)

      const added = await database.addMediaToGallery({
        actorId: currentActor.id,
        mediaIds: eligible
      })
      if (added.length === 0) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { media_ids: added }
      })
    },
    guardOptions
  )
)
