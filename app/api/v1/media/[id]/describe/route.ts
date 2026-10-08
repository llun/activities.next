import { getConfig } from '@/lib/config'
import { generateAltText } from '@/lib/services/altText/openai'
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

// POST /api/v1/media/:id/describe — generates alt text for a media the caller
// owns, with the instance's configured alt text service, from the STORED file
// (the image, or a video's poster frame). It returns the text and persists
// nothing: the composer shows it for the author to edit and saves it with
// PUT /api/v1/media/:id. Same scopes as the other media management routes.
export const POST = traceApiRoute(
  'describeMedia',
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

      const { altText } = getConfig()
      if (!altText) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Alt text generation is not configured' },
          responseStatusCode: 503
        })
      }

      // An image describes itself; a video is described from its poster frame.
      // Audio, and a video with no stored frame, have nothing to look at.
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
          data: { error: 'This media has no image to describe' },
          responseStatusCode: 422
        })
      }

      let description: string | null = null
      try {
        const image = await readStoredImage(database, sourcePath)
        if (image) {
          description = await generateAltText(
            altText,
            image.buffer,
            image.mimeType
          )
        }
      } catch (error) {
        logger.warn({
          message: 'Failed to read stored media for alt text generation',
          mediaId: media.id,
          err: toLoggableError(error)
        })
      }

      if (!description) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Alt text could not be generated' },
          responseStatusCode: 503
        })
      }

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { description }
      })
    },
    guardOptions
  )
)
