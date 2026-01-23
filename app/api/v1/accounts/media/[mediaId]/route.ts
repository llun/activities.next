import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { deleteMediaFile } from '@/lib/services/medias'
import { logger } from '@/lib/utils/logger'
import { apiErrorResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

interface Params {
  mediaId: string
}

export const DELETE = traceApiRoute(
  'deleteMedia',
  AuthenticatedGuard<Params>(async (_req, context) => {
    const { database, currentActor, params } = context
    const { mediaId } = (await params) ?? { mediaId: undefined }

    const account = currentActor.account
    if (!account) {
      logger.warn({ message: 'Unauthorized delete media request - no account' })
      return apiErrorResponse(401)
    }

    if (!mediaId) {
      logger.warn({ message: 'Bad request - missing mediaId' })
      return apiErrorResponse(400)
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
      return apiErrorResponse(404)
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
      return apiErrorResponse(500)
    }

    logger.info({
      message: 'Media deleted successfully',
      mediaId,
      accountId: account.id
    })

    return Response.json({ success: true })
  }),
  {
    addAttributes: async (_req, context) => {
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
