import { getMediaAlbums } from '@/lib/services/gallery/galleryAlbumQueries'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_404, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

interface Params {
  id: string
}

// GET /api/v1/media/:id/albums — which of the caller's albums hold this photo,
// with the caller's whole album list for the add-to-album menu, and whether
// the photo can be added to one (`addable`: posted and in the gallery). Owner
// only: media that is not the caller's, and one that does not exist, are the
// same 404, so the route cannot be used to probe for other people's media.
// Album membership is owner data and is never part of the public details.
export const GET = traceApiRoute(
  'getMediaAlbums',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, { database, currentActor, params }) => {
      const account = currentActor.account
      const { id } = (await params) ?? { id: undefined }
      const media =
        account && id
          ? await database.getMediaByIdForAccount({
              mediaId: id,
              accountId: account.id
            })
          : null
      // Albums belong to an actor, so the photo must be this actor's own, not
      // just one of the same account's.
      if (!media || media.actorId !== currentActor.id) {
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
        data: await getMediaAlbums({
          database,
          owner: currentActor,
          mediaId: media.id
        })
      })
    },
    guardOptions
  )
)
