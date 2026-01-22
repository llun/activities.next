import { SpanStatusCode } from '@opentelemetry/api'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { logger } from '@/lib/utils/logger'
import { apiErrorResponse } from '@/lib/utils/response'
import { getSpan } from '@/lib/utils/trace'

interface Params {
  mediaId: string
}

export const DELETE = AuthenticatedGuard<Params>(async (_req, context) => {
  const span = getSpan('api', 'deleteMedia')

  try {
    const { database, currentActor, params } = context
    const { mediaId } = (await params) ?? { mediaId: undefined }

    const account = currentActor.account
    if (!account) {
      logger.warn({ message: 'Unauthorized delete media request - no account' })
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'Unauthorized' })
      span.end()
      return apiErrorResponse(401)
    }

    if (!mediaId) {
      logger.warn({ message: 'Bad request - missing mediaId' })
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'Missing mediaId' })
      span.end()
      return apiErrorResponse(400)
    }

    span.setAttribute('mediaId', mediaId)
    span.setAttribute('accountId', account.id)

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
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: 'Media not found'
      })
      span.end()
      return apiErrorResponse(404)
    }

    // Delete the media
    const deleted = await database.deleteMedia({ mediaId })
    if (!deleted) {
      logger.error({
        message: 'Failed to delete media',
        mediaId,
        accountId: account.id
      })
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: 'Failed to delete media'
      })
      span.end()
      return apiErrorResponse(500)
    }

    logger.info({
      message: 'Media deleted successfully',
      mediaId,
      accountId: account.id
    })
    span.setStatus({ code: SpanStatusCode.OK })
    span.end()

    return Response.json({ success: true })
  } catch (e) {
    const nodeErr = e as NodeJS.ErrnoException
    logger.error({
      message: 'Failed to delete media',
      err: nodeErr
    })
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: 'Failed to delete media'
    })
    span.recordException(nodeErr)
    span.end()
    return apiErrorResponse(500)
  }
})
