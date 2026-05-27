import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { deleteMediaFile } from '@/lib/services/medias'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import {
  ERROR_400,
  ERROR_401,
  ERROR_404,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.DELETE]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  mediaId: string
}

export const DELETE = traceApiRoute(
  'deleteMedia',
  AuthenticatedGuard<Params>(async (req, context) => {
    const { database, currentActor, params } = context
    const { mediaId } = (await params) ?? { mediaId: undefined }

    const account = currentActor.account
    if (!account) {
      logger.warn({ message: 'Unauthorized delete media request - no account' })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_401,
        responseStatusCode: 401
      })
    }

    if (!mediaId) {
      logger.warn({ message: 'Bad request - missing mediaId' })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }

    // Verify the media belongs to an actor in this account
    const media = await database.getMediaByIdForAccount({
      mediaId,
      accountId: account.id
    })

    if (!media) {
      logger.warn({
        message: 'Media not found or not owned by account',
        mediaId,
        accountId: account.id
      })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })
    }

    // Delete the storage files (original and thumbnail if present)
    const filesToDelete: string[] = [media.original.path]
    if (media.thumbnail) {
      filesToDelete.push(media.thumbnail.path)
    }

    // Delete files from storage
    const deletionResults = await Promise.allSettled(
      filesToDelete.map((filePath) => deleteMediaFile(database, filePath))
    )

    // Log any failures but don't fail the operation
    deletionResults.forEach((result, index) => {
      if (result.status === 'rejected' || !result.value) {
        logger.warn({
          message: 'Failed to delete storage file',
          filePath: filesToDelete[index],
          mediaId,
          accountId: account.id
        })
      }
    })

    // Delete the media record from database
    const deleted = await database.deleteMedia({ mediaId })
    if (!deleted) {
      logger.error({
        message: 'Failed to delete media',
        mediaId,
        accountId: account.id
      })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }

    logger.info({
      message: 'Media deleted successfully',
      mediaId,
      accountId: account.id
    })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { success: true }
    })
  }),
  {
    addAttributes: async (_req, context) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { currentActor, params } = context as any
      const { mediaId } = (await params) ?? { mediaId: undefined }
      const account = currentActor?.account

      const attributes: Record<string, string | number | boolean> = {}
      if (mediaId) {
        attributes.mediaId = mediaId
      }
      if (account?.id) {
        attributes.accountId = account.id
      }
      return attributes
    }
  }
)
