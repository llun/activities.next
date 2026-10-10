import { NextRequest } from 'next/server'
import sharp from 'sharp'

import { getPhotoEditorConfig } from '@/lib/config'
import { createWindowCounter } from '@/lib/services/gallery/lookups/rateLimit'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import {
  MEDIA_NOT_EDITABLE_ERROR,
  isEditableMedia
} from '@/lib/services/medias/edit/editable'
import { requestEnhance } from '@/lib/services/medias/edit/enhance'
import { ERROR_RECORD_NOT_FOUND } from '@/lib/services/medias/edit/saveMediaEdit'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { ERROR_401, apiResponse, defaultOptions } from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

interface Params {
  id: string
}

export const ENHANCE_PREVIEW_MAX_BYTES = 3 * 1024 * 1024
export const ENHANCE_PREVIEW_MAX_LONG_EDGE = 1536
export const ENHANCE_PREVIEW_MIME_TYPE = 'image/jpeg'

export const ERROR_ENHANCE_OFF = 'AI enhance is turned off'
export const ERROR_ENHANCE_NOT_SET_UP = 'AI enhance is not set up'
export const ERROR_ENHANCE_TOO_MANY = 'Too many requests'
export const ERROR_ENHANCE_FAILED = "Couldn't get a suggestion"
export const ERROR_ENHANCE_PREVIEW = 'The preview must be a JPEG'
export const ERROR_ENHANCE_PREVIEW_SIZE = 'The preview is too large'

// 30 suggestions per actor per hour: each one is a call to the vision model.
const ENHANCES_PER_HOUR = 30
const enhanceRuns = createWindowCounter({
  limit: ENHANCES_PER_HOUR,
  windowMs: 60 * 60 * 1000
})

const answer = (
  req: NextRequest,
  data: unknown,
  responseStatusCode?: 200 | 401 | 404 | 409 | 413 | 422 | 429 | 502 | 503
) =>
  apiResponse({ req, allowedMethods: CORS_HEADERS, data, responseStatusCode })

/**
 * Whether the bytes are a JPEG whose long edge fits the cap. Reads the header
 * only; a file sharp cannot read is not a preview.
 */
const isValidPreview = async (buffer: Buffer): Promise<boolean> => {
  try {
    const { format, width, height } = await sharp(buffer).metadata()
    return (
      format === 'jpeg' &&
      Boolean(width) &&
      Boolean(height) &&
      Math.max(width ?? 0, height ?? 0) <= ENHANCE_PREVIEW_MAX_LONG_EDGE
    )
  } catch {
    return false
  }
}

// POST /api/v1/media/:id/edit/enhance — asks the vision model for suggested
// slider values for a media the caller owns. Multipart: `preview`, a JPEG of at
// most 3 MB and 1536 px on its long edge that the editor renders with the
// current crop and no adjustments. Answers `{ natural, vivid, dramatic, model }`
// (see enhanceSchema.ts). Nothing is stored: the preview goes to the model and
// is forgotten, and the answer is not kept. Same scopes as the other edit
// routes. Checked in this order: the owner's switch (409), the server's model
// (503), the rate limit (429).
export const POST = traceApiRoute(
  'enhanceMediaEdit',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:media']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const account = currentActor.account
      if (!account) return answer(req, ERROR_401, 401)

      const { id } = (await params) ?? { id: undefined }
      const media = id
        ? await database.getMediaByIdForAccount({
            mediaId: id,
            accountId: account.id
          })
        : null
      if (!media) return answer(req, { error: ERROR_RECORD_NOT_FOUND }, 404)
      if (!isEditableMedia(media)) {
        return answer(req, { error: MEDIA_NOT_EDITABLE_ERROR }, 422)
      }

      // The photo's own actor's switch, as the editor's capabilities read it.
      const { photoEnhance } = await database.getGallerySettings({
        actorId: media.actorId
      })
      if (!photoEnhance) return answer(req, { error: ERROR_ENHANCE_OFF }, 409)

      const { enhance } = getPhotoEditorConfig()
      if (!enhance) return answer(req, { error: ERROR_ENHANCE_NOT_SET_UP }, 503)

      let preview: FormDataEntryValue | null = null
      try {
        preview = (await req.formData()).get('preview')
      } catch {
        // Answered below as a missing preview.
      }
      if (!(preview instanceof File)) {
        return answer(req, { error: ERROR_ENHANCE_PREVIEW }, 422)
      }
      if (preview.type !== ENHANCE_PREVIEW_MIME_TYPE) {
        return answer(req, { error: ERROR_ENHANCE_PREVIEW }, 422)
      }
      if (preview.size > ENHANCE_PREVIEW_MAX_BYTES) {
        return answer(req, { error: ERROR_ENHANCE_PREVIEW_SIZE }, 413)
      }
      const buffer = Buffer.from(await preview.arrayBuffer())
      if (!(await isValidPreview(buffer))) {
        return answer(req, { error: ERROR_ENHANCE_PREVIEW }, 422)
      }

      if (!enhanceRuns.tryHit(currentActor.id)) {
        return answer(req, { error: ERROR_ENHANCE_TOO_MANY }, 429)
      }

      try {
        return answer(req, await requestEnhance(enhance, buffer))
      } catch (error) {
        logger.warn({
          message: 'Failed to get an AI enhance suggestion',
          mediaId: media.id,
          err: toLoggableError(error)
        })
        return answer(req, { error: ERROR_ENHANCE_FAILED }, 502)
      }
    },
    guardOptions
  )
)
