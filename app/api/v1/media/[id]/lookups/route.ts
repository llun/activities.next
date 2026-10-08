import {
  publishPlaceLookup,
  publishSubjectLookup
} from '@/lib/services/gallery/lookups/publishLookups'
import { createWindowCounter } from '@/lib/services/gallery/lookups/rateLimit'
import { getSubjectThreatStatus } from '@/lib/services/gallery/threatenedSpecies'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getOwnerMediaAttachment } from '@/lib/services/medias/mediaDetails'
import { EMPTY_MEDIA_DETAILS } from '@/lib/types/database/gallery'
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

// 20 retries per actor per hour. Each one asks Nominatim and GBIF again (it
// skips the failures the lookup cache remembers), so it is bounded like the
// other routes that reach a provider.
const RETRIES_PER_HOUR = 20
const ONE_HOUR_MS = 60 * 60 * 1000
const retries = createWindowCounter({
  limit: RETRIES_PER_HOUR,
  windowMs: ONE_HOUR_MS
})

// A finished place lookup: nothing to retry.
const FINAL_PLACE_STATUSES = new Set(['resolved', 'no-match'])

// POST /api/v1/media/:id/lookups — publishes the place and subject lookups of
// a media the caller owns again, for the dialog's "Couldn't check · Retry".
// Only a lookup that has not finished is queued: a place with coordinates that
// is not `resolved` or `no-match` (a null status included, the state an edit
// leaves when its job was lost), and a species-like subject whose threat
// status is still unchecked. Each job gets a fresh id and is told it is a
// retry, so it asks the provider again rather than answering a remembered
// failure (an open circuit still fails fast). The jobs re-read the media and
// re-check the admin switches themselves, so this only queues them (under
// NoQueue they run before this answers) and returns the owner's details as
// they are now. Same scopes and 404 rule as `describe`.
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

      if (!retries.tryHit(currentActor.id)) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Too many requests' },
          responseStatusCode: 429
        })
      }

      const details = { ...EMPTY_MEDIA_DETAILS, ...media.details }
      const latitude = details.placeLatitude
      const longitude = details.placeLongitude
      if (
        typeof latitude === 'number' &&
        typeof longitude === 'number' &&
        !FINAL_PLACE_STATUSES.has(details.placeLookupStatus ?? '')
      ) {
        await publishPlaceLookup({
          mediaId: media.id,
          latitude,
          longitude,
          fresh: true,
          retry: true
        })
      }
      // `unchecked` is every species-like subject not yet cleared or found
      // threatened, a subject known only by its taxon key included.
      if (getSubjectThreatStatus(details) === 'unchecked') {
        await publishSubjectLookup({
          mediaId: media.id,
          subjectName: details.subjectName,
          subjectScientificName: details.subjectScientificName,
          subjectCategory: details.subjectCategory,
          subjectTaxonKey: details.subjectTaxonKey,
          fresh: true,
          retry: true
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
