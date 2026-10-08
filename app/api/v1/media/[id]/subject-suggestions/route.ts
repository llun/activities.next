import { z } from 'zod'

import { getGalleryLookupAvailability } from '@/lib/services/gallery/galleryLookupAvailability'
import { createGbifClient } from '@/lib/services/gallery/lookups/gbif'
import { createWindowCounter } from '@/lib/services/gallery/lookups/rateLimit'
import { getSubjectProviderConfig } from '@/lib/services/gallery/subjects/subjectProvider'
import { suggestSubjects } from '@/lib/services/gallery/subjects/suggestSubjects'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { readStoredImage } from '@/lib/services/medias/readStoredMedia'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import {
  ERROR_401,
  ERROR_404,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

interface Params {
  id: string
}

// 30 suggestion runs per actor per hour. Reading the stored suggestions back
// is free: only a run of the model counts.
const SUGGESTION_RUNS_PER_HOUR = 30
const ONE_HOUR_MS = 60 * 60 * 1000
const suggestionRuns = createWindowCounter({
  limit: SUGGESTION_RUNS_PER_HOUR,
  windowMs: ONE_HOUR_MS
})

const SuggestionsRequest = z.object({ refresh: z.boolean().optional() })

// POST /api/v1/media/:id/subject-suggestions — the vision model's guesses at the
// subject of a media the caller owns, optionally checked against GBIF. The
// result is persisted on the media (owner-only), so reopening the dialog or
// another device does not ask the model again. Suggestions are never decisions:
// nothing here touches the `subject*` columns. Same scopes as `describe`.
// An owner whose Suggestions setting is off gets 409 for every call: the
// setting is enforced here, not only by the web client, so a stale tab or
// another client never sends the photo to the vision model.
export const POST = traceApiRoute(
  'suggestMediaSubjects',
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

      const { subjectSuggestionMode } = await database.getGallerySettings({
        actorId: currentActor.id
      })
      if (subjectSuggestionMode === 'off') {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Subject suggestions are turned off' },
          responseStatusCode: 409
        })
      }

      // An empty body, or one that is not JSON at all, reads as `{}`. A JSON
      // body of the wrong shape (`{"refresh":"true"}`) is refused, so a client
      // learns its refresh was not understood rather than silently getting
      // the stored suggestions back.
      let body: unknown = {}
      try {
        body = await req.json()
      } catch {
        // No body.
      }
      const parsed = SuggestionsRequest.safeParse(body ?? {})
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Invalid input' },
          responseStatusCode: 422
        })
      }
      const refresh = parsed.data.refresh === true

      const stored = media.details?.subjectSuggestions ?? null
      if (stored && !refresh) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { suggestions: stored }
        })
      }

      const config = getSubjectProviderConfig()
      if (!config) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Subject suggestions are not configured' },
          responseStatusCode: 503
        })
      }

      // An image looks at itself; a video is read from its poster frame. Audio,
      // and a video with no stored frame, have nothing to look at.
      const isImage = media.original.mimeType.startsWith('image')
      const isVideo = media.original.mimeType.startsWith('video')
      const sourcePath = isImage
        ? media.original.path
        : isVideo
          ? media.thumbnail?.path
          : undefined
      if (!sourcePath) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'This media has no image to look at' },
          responseStatusCode: 422
        })
      }

      if (!suggestionRuns.tryHit(currentActor.id)) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Too many requests' },
          responseStatusCode: 429
        })
      }

      try {
        const image = await readStoredImage(database, sourcePath)
        if (!image) throw new Error('The stored media could not be read')

        const { speciesLookupsAvailable } =
          await getGalleryLookupAvailability(database)
        const suggestions = await suggestSubjects({
          config,
          image,
          gbif: speciesLookupsAvailable ? createGbifClient({ database }) : null
        })

        const persisted = await database.setMediaSubjectSuggestions({
          mediaId: media.id,
          suggestions
        })
        if (!persisted) {
          logger.warn({
            message: 'Subject suggestions were not stored',
            mediaId: media.id
          })
        }

        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { suggestions }
        })
      } catch (error) {
        logger.warn({
          message: 'Failed to suggest subjects for uploaded media',
          mediaId: media.id,
          err: toLoggableError(error)
        })
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Subjects could not be suggested' },
          responseStatusCode: 503
        })
      }
    },
    guardOptions
  )
)
