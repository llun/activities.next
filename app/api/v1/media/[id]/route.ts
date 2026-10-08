import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import {
  publishPlaceLookup,
  publishSubjectLookup
} from '@/lib/services/gallery/lookups/publishLookups'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { AuthenticatedApiHandle } from '@/lib/services/guards/types'
import { deleteMediaFile, saveMediaThumbnail } from '@/lib/services/medias'
import { MediaValidationError } from '@/lib/services/medias/errors'
import { getOwnerMediaAttachment } from '@/lib/services/medias/mediaDetails'
import {
  MEDIA_DETAILS_REQUEST_KEYS,
  MediaDetailsRequest
} from '@/lib/services/medias/mediaDetailsRequest'
import { FileSchema, MediaSchema } from '@/lib/services/medias/types'
import { exceedsMaxMediaUploadSize } from '@/lib/services/medias/uploadSizeLimit'
import {
  Media,
  Scope,
  UpdateMediaDetailsParams
} from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import {
  ERROR_401,
  ERROR_404,
  ERROR_422,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.PUT,
  HttpMethod.enum.PATCH,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// Attach the route's CORS allow-list to the guard's auth-failure responses so
// cross-origin clients can read 401/403/500 instead of an opaque CORS error.
const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

interface Params {
  id: string
}

// Request fields that change a media's subject; any of them being sent queues a
// lookup of the stored subject. `subject_taxon_key` is accepted by the request
// schema once the data layer lands.
const SUBJECT_REQUEST_KEYS: readonly string[] = [
  'subject_name',
  'subject_scientific_name',
  'subject_category',
  'subject_taxon_key'
]

// Beyond Mastodon's fields this route also takes the non-Mastodon media details
// (subject, gear, place, `in_gallery`); see MediaDetailsRequest.
//
// Reuse MediaSchema's `description` + `focus` validation so the update path can
// never drift from the upload path (same 1500-char cap, same empty/whitespace/
// null -> null normalization, same focus "x,y" parsing that yields a 422 on
// malformed input). Both fields are optional; field-level presence is detected
// from the raw payload so a partial update never clears a field the client
// omitted.
const UpdateMediaRequest = MediaSchema.pick({
  description: true,
  focus: true
}).extend(MediaDetailsRequest.shape)

const readPayload = async (
  req: Request
): Promise<Record<string, unknown> | null> => {
  const contentType = req.headers.get('content-type') ?? ''
  try {
    if (contentType.includes('application/json')) {
      const body = await req.json()
      return body && typeof body === 'object'
        ? (body as Record<string, unknown>)
        : {}
    }
    const form = await req.formData()
    return Object.fromEntries(form.entries())
  } catch {
    return null
  }
}

// Mastodon's MediaController applies `doorkeeper_authorize! :write, :'write:media'`
// to every action, including `show` (media management happens while composing),
// so GET requires write/write:media too.
export const GET = traceApiRoute(
  'getMedia',
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
      if (!id) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      const media = await database.getMediaByIdForAccount({
        mediaId: id,
        accountId: account.id
      })
      if (!media) {
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
        data: await getOwnerMediaAttachment(
          database,
          media,
          headerHost(req.headers)
        )
      })
    },
    guardOptions
  )
)

type DetailsUpdate = { details: UpdateMediaDetailsParams } | { error: string }

// Turns the validated request into the column patch, enforcing what a schema
// cannot: the gear must be the media owner's (and of the right kind), a place
// needs both coordinates or neither, and setting a subject on a photo that had
// none puts it in the gallery when the owner's default is "once it has a
// subject" and the request did not say otherwise.
const resolveDetailsUpdate = async ({
  database,
  existing,
  parsed,
  providedKeys
}: {
  database: Database
  existing: Media
  parsed: MediaDetailsRequest
  providedKeys: (keyof MediaDetailsRequest)[]
}): Promise<DetailsUpdate> => {
  const provided = new Set<string>(providedKeys)
  const current = existing.details
  const details: UpdateMediaDetailsParams = {}

  if (provided.has('subject_name')) {
    details.subjectName = parsed.subject_name ?? null
  }
  if (provided.has('subject_scientific_name')) {
    details.subjectScientificName = parsed.subject_scientific_name ?? null
  }
  if (provided.has('subject_category')) {
    details.subjectCategory = parsed.subject_category ?? null
  }
  if (provided.has('subject_taxon_key')) {
    details.subjectTaxonKey = parsed.subject_taxon_key ?? null
  }
  if (provided.has('place_name')) details.placeName = parsed.place_name ?? null
  if (provided.has('place_precision')) {
    details.placePrecision = parsed.place_precision ?? null
  }
  if (provided.has('place_latitude')) {
    details.placeLatitude = parsed.place_latitude ?? null
  }
  if (provided.has('place_longitude')) {
    details.placeLongitude = parsed.place_longitude ?? null
  }
  if (provided.has('in_gallery')) details.inGallery = parsed.in_gallery

  if (provided.has('place_latitude') || provided.has('place_longitude')) {
    const latitude =
      'placeLatitude' in details
        ? details.placeLatitude
        : (current?.placeLatitude ?? null)
    const longitude =
      'placeLongitude' in details
        ? details.placeLongitude
        : (current?.placeLongitude ?? null)
    if ((latitude === null) !== (longitude === null)) {
      return { error: 'A place needs both a latitude and a longitude' }
    }
  }

  const gearFields = [
    ['camera_gear_id', 'camera', 'cameraGearId'],
    ['lens_gear_id', 'lens', 'lensGearId']
  ] as const
  for (const [key, kind, column] of gearFields) {
    if (!provided.has(key)) continue
    const gearId = parsed[key] ?? null
    if (gearId !== null) {
      const gear = await database.getGalleryGear({
        id: gearId,
        actorId: existing.actorId
      })
      if (!gear || gear.kind !== kind) {
        return { error: `Unknown ${kind} gear` }
      }
    }
    details[column] = gearId
  }

  if (
    details.subjectName &&
    !current?.subjectName &&
    details.inGallery === undefined
  ) {
    const settings = await database.getGallerySettings({
      actorId: existing.actorId
    })
    if (settings.galleryDefault === 'subject') details.inGallery = true
  }

  return { details }
}

// PUT and PATCH both map to Mastodon's `update` action (Rails `resources :media`
// exposes both verbs); they share one handler. write/write:media scope.
const updateMediaHandler: AuthenticatedApiHandle<Params> = async (
  req,
  context
) => {
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
  if (!id) {
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: ERROR_404,
      responseStatusCode: 404
    })
  }

  const payload = await readPayload(req)
  if (!payload) {
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: ERROR_422,
      responseStatusCode: 422
    })
  }

  const parsed = UpdateMediaRequest.safeParse(payload)
  if (!parsed.success) {
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: ERROR_422,
      responseStatusCode: 422
    })
  }

  // Detect which fields the client actually sent from the raw payload (before
  // Zod fills omitted optionals) so a partial update only mutates those fields.
  const descriptionProvided = 'description' in payload
  const focusProvided = 'focus' in payload
  const providedDetailsKeys = MEDIA_DETAILS_REQUEST_KEYS.filter(
    (key) => key in payload
  )
  const detailsProvided = providedDetailsKeys.length > 0

  // A `thumbnail` field carries content when it is a non-empty File or a
  // non-blank value. An absent field, empty string, or 0-byte file is treated
  // as "not provided"; any other present value is validated as an image File so
  // an invalid thumbnail returns 422 instead of being silently ignored.
  const rawThumbnail = payload.thumbnail
  const thumbnailFieldHasContent =
    rawThumbnail != null &&
    !(typeof rawThumbnail === 'string' && rawThumbnail.trim() === '') &&
    !(rawThumbnail instanceof File && rawThumbnail.size === 0)

  if (thumbnailFieldHasContent) {
    const thumbnailCheck = FileSchema.safeParse(rawThumbnail)
    // The size cap is the resolved `media.maxFileSize` server setting (a
    // database read), so it is checked here rather than inside FileSchema.
    if (
      !thumbnailCheck.success ||
      (await exceedsMaxMediaUploadSize([thumbnailCheck.data.size], database))
    ) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: 422
      })
    }
  }

  // After the check above, a present-with-content thumbnail is a valid File.
  const thumbnailProvided = thumbnailFieldHasContent

  // Nothing to change — return the current attachment (404 if not owned).
  if (
    !descriptionProvided &&
    !focusProvided &&
    !thumbnailProvided &&
    !detailsProvided
  ) {
    const media = await database.getMediaByIdForAccount({
      mediaId: id,
      accountId: account.id
    })
    if (!media) {
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
      data: await getOwnerMediaAttachment(
        database,
        media,
        headerHost(req.headers)
      )
    })
  }

  let details: UpdateMediaDetailsParams | undefined
  let previousCoordinates: { latitude: number; longitude: number } | null = null
  if (detailsProvided) {
    const existing = await database.getMediaByIdForAccount({
      mediaId: id,
      accountId: account.id
    })
    if (!existing) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })
    }

    const resolved = await resolveDetailsUpdate({
      database,
      existing,
      parsed: parsed.data,
      providedKeys: providedDetailsKeys
    })
    if ('error' in resolved) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: resolved.error },
        responseStatusCode: 422
      })
    }
    details = resolved.details
    previousCoordinates =
      existing.details?.placeLatitude != null &&
      existing.details?.placeLongitude != null
        ? {
            latitude: existing.details.placeLatitude,
            longitude: existing.details.placeLongitude
          }
        : null
  }

  // Produce the new stored thumbnail (if any) before touching the DB. The
  // owner check happens in updateMedia (returns null when not owned); the early
  // getMediaByIdForAccount avoids processing a thumbnail for media that isn't
  // the caller's.
  let thumbnail
  if (thumbnailProvided) {
    const existing = await database.getMediaByIdForAccount({
      mediaId: id,
      accountId: account.id
    })
    if (!existing) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })
    }
    try {
      thumbnail = await saveMediaThumbnail(
        database,
        currentActor,
        rawThumbnail as File
      )
    } catch (error) {
      // Quota exceeded / invalid media are client errors (422); anything else is
      // an unexpected storage failure (500).
      if (error instanceof MediaValidationError) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }
      throw error
    }
    if (!thumbnail) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: 422
      })
    }
  }

  let result
  try {
    result = await database.updateMedia({
      mediaId: id,
      accountId: account.id,
      ...(descriptionProvided ? { description: parsed.data.description } : {}),
      ...(focusProvided ? { focus: parsed.data.focus } : {}),
      ...(details ? { details } : {}),
      ...(thumbnail
        ? {
            thumbnail,
            ...(thumbnail.blurhash ? { blurhash: thumbnail.blurhash } : {})
          }
        : {})
    })
  } catch (error) {
    // Don't leak the freshly-stored thumbnail if persisting the update failed.
    if (thumbnail) {
      await deleteMediaFile(database, thumbnail.path).catch(() => false)
    }
    throw error
  }

  if (!result) {
    // Owner check failed inside updateMedia; clean up the orphaned thumbnail we
    // just stored so it doesn't leak. Best-effort — a cleanup failure must not
    // turn the 404 into a 500.
    if (thumbnail) {
      await deleteMediaFile(database, thumbnail.path).catch(() => false)
    }
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: ERROR_404,
      responseStatusCode: 404
    })
  }

  // Remove the thumbnail this update replaced. The path is captured inside
  // updateMedia's transaction (not a prefetch), so a concurrent update can't
  // cause stale-path cleanup. Best-effort: a storage hiccup must not fail an
  // update that already committed to the database.
  if (result.replacedThumbnailPath) {
    try {
      const removed = await deleteMediaFile(
        database,
        result.replacedThumbnailPath
      )
      if (!removed) {
        logger.warn({
          message: 'Failed to delete replaced thumbnail file',
          filePath: result.replacedThumbnailPath,
          mediaId: id,
          accountId: account.id
        })
      }
    } catch (error) {
      logger.warn({
        message: 'Error deleting replaced thumbnail file',
        filePath: result.replacedThumbnailPath,
        mediaId: id,
        accountId: account.id,
        error: (error as Error).message
      })
    }
  }

  logger.info({
    message: 'Media updated',
    mediaId: id,
    accountId: account.id
  })

  // The update has committed; look up what changed. Each publish swallows its
  // own failure, so neither can fail this request.
  if (details) {
    const updated = result.media.details
    const latitude = updated?.placeLatitude
    const longitude = updated?.placeLongitude
    if (
      typeof latitude === 'number' &&
      typeof longitude === 'number' &&
      (latitude !== previousCoordinates?.latitude ||
        longitude !== previousCoordinates?.longitude)
    ) {
      await publishPlaceLookup({ mediaId: id, latitude, longitude })
    }
    if (
      providedDetailsKeys.some((key) =>
        SUBJECT_REQUEST_KEYS.includes(key as string)
      )
    ) {
      await publishSubjectLookup({
        mediaId: id,
        subjectName: updated?.subjectName ?? null,
        subjectScientificName: updated?.subjectScientificName ?? null,
        subjectCategory: updated?.subjectCategory ?? null,
        subjectTaxonKey: updated?.subjectTaxonKey ?? null
      })
    }
  }

  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: await getOwnerMediaAttachment(
      database,
      result.media,
      headerHost(req.headers)
    )
  })
}

export const PUT = traceApiRoute(
  'updateMedia',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:media']],
    updateMediaHandler,
    guardOptions
  )
)

export const PATCH = traceApiRoute(
  'updateMedia',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:media']],
    updateMediaHandler,
    guardOptions
  )
)

export const DELETE = traceApiRoute(
  'deleteMedia',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:media']],
    async (req: NextRequest, context) => {
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
      if (!id) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      const result = await database.deleteMediaForAccount({
        mediaId: id,
        accountId: account.id
      })

      // Media already attached to a posted status can't be deleted (Mastodon
      // returns 422 in_usage_error).
      if (result.status === 'in-use') {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }

      if (result.status === 'not-found') {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      // Best-effort removal of the original + thumbnail files now that the row
      // is gone. The paths come from inside the delete transaction (no racy
      // prefetch). Storage failures are logged but don't fail the request — the
      // record is already deleted and the usage counter decremented.
      const deletions = await Promise.allSettled(
        result.files.map((filePath) => deleteMediaFile(database, filePath))
      )
      deletions.forEach((deletion, index) => {
        if (deletion.status === 'rejected' || !deletion.value) {
          logger.warn({
            message: 'Failed to delete storage file for deleted media',
            filePath: result.files[index],
            mediaId: id,
            accountId: account.id
          })
        }
      })

      logger.info({
        message: 'Media deleted',
        mediaId: id,
        accountId: account.id
      })

      // Mastodon's destroy renders an empty object with 200.
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {}
      })
    },
    guardOptions
  )
)
