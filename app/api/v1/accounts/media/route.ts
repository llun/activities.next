import { SpanStatusCode } from '@opentelemetry/api'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { getQuotaLimit } from '@/lib/services/medias/quota'
import { logger } from '@/lib/utils/logger'
import { apiErrorResponse } from '@/lib/utils/response'
import { getSpan } from '@/lib/utils/trace'

export const GET = AuthenticatedGuard(async (req, context) => {
  const span = getSpan('api', 'getMediasForAccount')

  try {
    const { database, currentActor } = context

    const account = currentActor.account
    if (!account) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: 'No account found'
      })
      span.end()
      logger.warn('Get medias failed: No account found')
      return apiErrorResponse(401)
    }

    span.setAttribute('accountId', account.id)

    // Parse pagination parameters from URL with defaults and validation
    const url = new URL(req.url)
    const pageParam = url.searchParams.get('page')
    const limitParam = url.searchParams.get('limit')

    const page = Math.max(1, Math.min(10000, parseInt(pageParam || '1', 10)))
    const limit = [25, 50, 100].includes(parseInt(limitParam || '25', 10))
      ? parseInt(limitParam || '25', 10)
      : 25

    span.setAttribute('page', page)
    span.setAttribute('limit', limit)

    // Get storage usage
    const used = await database.getStorageUsageForAccount({
      accountId: account.id
    })

    // Get quota limit
    const quotaLimit = getQuotaLimit()

    // Get medias for account with pagination and statusId
    const result = await database.getMediasWithStatusForAccount({
      accountId: account.id,
      limit,
      page
    })

    span.setAttribute('totalMedias', result.total)
    span.setStatus({ code: SpanStatusCode.OK })
    span.end()

    return Response.json({
      used,
      limit: quotaLimit,
      total: result.total,
      page,
      itemsPerPage: limit,
      medias: result.items.map((media) => ({
        id: media.id,
        actorId: media.actorId,
        bytes: media.original.bytes + (media.thumbnail?.bytes ?? 0),
        mimeType: media.original.mimeType,
        width: media.original.metaData.width,
        height: media.original.metaData.height,
        description: media.description,
        statusId: media.statusId
      }))
    })
  } catch (e) {
    const error = e as Error
    span.recordException(error)
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
    span.end()
    logger.error({
      message: 'Get medias failed',
      error: error.message,
      stack: error.stack
    })
    return apiErrorResponse(500)
  }
})
