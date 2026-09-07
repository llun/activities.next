import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { getQuotaLimit } from '@/lib/services/medias/quota'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { ERROR_401, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

import { parseAccountMediaPagination } from './pagination'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'getMediasForAccount',
  AuthenticatedGuard(async (req, context) => {
    const { database, currentActor } = context

    const account = currentActor.account
    if (!account) {
      logger.warn('Get medias failed: No account found')
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_401,
        responseStatusCode: 401
      })
    }

    const { page, limit } = parseAccountMediaPagination(req.url)

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

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: {
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
      }
    })
  }),
  {
    addAttributes: async (req) => {
      const { page, limit } = parseAccountMediaPagination(req.url)
      return {
        page,
        limit
      }
    }
  }
)
