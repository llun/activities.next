import { buildPublicMediaDetails } from '@/lib/services/gallery/publicMediaDetails'
import { OptionalOAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { canActorReadStatus } from '@/lib/services/statusAccess'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_404, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  mediaId: string
}

// A media can hang off more than one status (a redraft re-attaches it). Reading
// is decided by the first the viewer may see, and this bounds how many are
// loaded to find out.
const MAX_STATUSES_CHECKED = 10

// GET /api/v1/gallery/media/:mediaId/details — the public-safe details of a
// photo, for the viewer. It answers only for media attached to a status the
// viewer may read (the same `canActorReadStatus` rule the status endpoints use)
// and 404s otherwise, so an unattached or private upload is indistinguishable
// from one that does not exist. What it returns is decided by
// `buildPublicMediaDetails`: coordinates are rounded or withheld by the media's
// `placePrecision`, a place inside one of the owner's hidden locations is
// withheld entirely, and gear is withheld unless the owner shows it.
export const GET = traceApiRoute(
  'getMediaPublicDetails',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const { mediaId } = (await params) ?? { mediaId: undefined }

      const found = mediaId
        ? await database.getMediaWithAttachedStatusIds({ mediaId })
        : null

      let readable = false
      if (found) {
        for (const statusId of found.statusIds.slice(0, MAX_STATUSES_CHECKED)) {
          const status = await database.getStatus({
            statusId,
            currentActorId: currentActor?.id,
            withReplies: false
          })
          if (
            status &&
            (await canActorReadStatus({ database, status, currentActor }))
          ) {
            readable = true
            break
          }
        }
      }

      if (!found || !readable) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      // The whole settings row goes through, `hiddenLocations` included: a
      // place inside a hidden location comes back as `place: null`.
      const settings = await database.getGallerySettings({
        actorId: found.media.actorId
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: await buildPublicMediaDetails({
          database,
          media: found.media,
          settings
        })
      })
    },
    { matchMode: 'any' }
  )
)
