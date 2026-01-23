import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { getQuotaLimit } from '@/lib/services/medias/quota'
import { logger } from '@/lib/utils/logger'
import { apiErrorResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const GET = traceApiRoute(
  'getMediasForAccount',
  AuthenticatedGuard(async (req, context) => {
    const { database, currentActor } = context

    const account = currentActor.account
    if (!account) {
      logger.warn('Get medias failed: No account found')
      return apiErrorResponse(401)
    }

    // Parse pagination parameters from URL with defaults and validation
    const url = new URL(req.url)
    const pageParam = url.searchParams.get('page')
    const limitParam = url.searchParams.get('limit')

    const page = Math.max(1, Math.min(10000, parseInt(pageParam || '1', 10)))
    const limit = [25, 50, 100].includes(parseInt(limitParam || '25', 10))
      ? parseInt(limitParam || '25', 10)
      : 25

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
  }),
  {
    addAttributes: async (req, context) => {
      const { currentActor } = context as any
      const account = currentActor?.account
      const url = new URL(req.url)
      const pageParam = url.searchParams.get('page')
      const limitParam = url.searchParams.get('limit')
      const page = Math.max(1, Math.min(10000, parseInt(pageParam || '1', 10)))
      const limit = [25, 50, 100].includes(parseInt(limitParam || '25', 10))
        ? parseInt(limitParam || '25', 10)
        : 25

      const attributes: Record<string, string | number | boolean> = {
        page,
        limit
      }
      if (account?.id) {
        attributes.accountId = account.id
      }
      return attributes
    }
  }
)
