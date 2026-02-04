import { NextRequest } from 'next/server'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { headerHost } from '@/lib/services/guards/headerHost'
import { AppRouterParams } from '@/lib/services/guards/types'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

const MediaQueryParams = z.object({
  max_created_at: z.coerce.number().optional(),
  limit: z.coerce.number().min(1).max(50).default(25).optional()
})

export const GET = traceApiRoute(
  'getAccountMedia',
  async (req: NextRequest, params: AppRouterParams<Params>) => {
    const database = getDatabase()
    if (!database) {
      return apiErrorResponse(500)
    }

    const { id: encodedAccountId } = await params.params
    if (!encodedAccountId) {
      return apiErrorResponse(400)
    }
    const id = idToUrl(encodedAccountId)

    const actor = await database.getActorFromId({
      id
    })
    if (!actor) {
      return apiErrorResponse(404)
    }

    const url = new URL(req.url)
    const queryParams = Object.fromEntries(url.searchParams.entries())
    const parsedParams = MediaQueryParams.parse(queryParams)

    const { limit = 25, max_created_at: maxCreatedAt } = parsedParams

    const attachments = await database.getAttachmentsForActor({
      actorId: id,
      limit,
      maxCreatedAt
    })

    const host = headerHost(req.headers)
    const pathBase = `/api/v1/accounts/${encodedAccountId}/media`

    const nextLink =
      attachments.length > 0
        ? `<https://${host}${pathBase}?limit=${limit}&max_created_at=${attachments[attachments.length - 1].createdAt}>; rel="next"`
        : null

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: attachments,
      additionalHeaders: [
        ...(nextLink ? [['Link', nextLink] as [string, string]] : [])
      ]
    })
  },
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)
