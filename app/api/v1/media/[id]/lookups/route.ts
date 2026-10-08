import {
  publishPlaceLookup,
  publishSubjectLookup
} from '@/lib/services/gallery/lookups/publishLookups'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getOwnerMediaAttachment } from '@/lib/services/medias/mediaDetails'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_401,
  ERROR_404,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

interface Params {
  id: string
}

// POST /api/v1/media/:id/lookups — publishes the place and subject lookups of
// a media the caller owns again, for the dialog's "Couldn't check · Retry". The
// jobs re-read the media and re-check the admin switches themselves, so this
// only queues them (under NoQueue they run before this answers) and returns
// the owner's details as they are now. Same scopes and 404 rule as `describe`.
export const POST = traceApiRoute(
  'retryMediaLookups',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:media']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const account = currentActor.account
      if (!account) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_401,
          responseStatusCode: 401
        })
      }

      const { id } = (await params) ?? { id: undefined }
      const media = id
        ? await database.getMediaByIdForAccount({
            mediaId: id,
            accountId: account.id
          })
        : null
      if (!media) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      const details = media.details
      const latitude = details?.placeLatitude
      const longitude = details?.placeLongitude
      if (typeof latitude === 'number' && typeof longitude === 'number') {
        await publishPlaceLookup({
          mediaId: media.id,
          latitude,
          longitude,
          force: true
        })
      }
      if (details?.subjectName || details?.subjectScientificName) {
        await publishSubjectLookup({
          mediaId: media.id,
          subjectName: details.subjectName,
          subjectScientificName: details.subjectScientificName,
          subjectCategory: details.subjectCategory,
          subjectTaxonKey: details.subjectTaxonKey ?? null,
          force: true
        })
      }

      // Inline queues have finished by now; a real queue shows the statuses
      // the lookups are about to replace, and the composer reads them again.
      const current =
        (await database.getMediaByIdForAccount({
          mediaId: media.id,
          accountId: account.id
        })) ?? media
      const attachment = await getOwnerMediaAttachment(
        database,
        current,
        headerHost(req.headers)
      )

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { details: attachment.details ?? null }
      })
    },
    guardOptions
  )
)
