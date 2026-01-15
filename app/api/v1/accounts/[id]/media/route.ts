import { z } from 'zod'

import { Scope } from '@/lib/database/types/oauth'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

const MediaQueryParams = z.object({
  max_id: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(25).optional()
})

export const GET = OAuthGuard<Params>(
  [Scope.enum.read],
  async (req, context) => {
    const { database, params } = context
    const encodedAccountId = (await params).id
    if (!encodedAccountId) {
      return apiErrorResponse(400)
    }
    const id = idToUrl(encodedAccountId)

    const actor = await database.getMastodonActorFromId({
      id
    })
    if (!actor) {
      return apiErrorResponse(404)
    }

    const url = new URL(req.url)
    const queryParams = Object.fromEntries(url.searchParams.entries())
    const parsedParams = MediaQueryParams.parse(queryParams)

    const { limit = 25, max_id: maxId } = parsedParams

    const attachments = await database.getAttachmentsForActor({
      actorId: id,
      limit,
      maxId
    })

    const host = headerHost(req.headers)
    const pathBase = `/api/v1/accounts/${encodedAccountId}/media`

    const nextLink =
      attachments.length > 0
        ? `<https://${host}${pathBase}?limit=${limit}&max_id=${attachments[attachments.length - 1].id}>; rel="next"`
        : null

    const prevLink =
      attachments.length > 0
        ? `<https://${host}${pathBase}?limit=${limit}&min_id=${attachments[0].id}>; rel="prev"`
        : null

    const links = [nextLink, prevLink].filter(Boolean).join(', ')

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: attachments,
      additionalHeaders: [
        ...(links.length > 0 ? [['Link', links] as [string, string]] : [])
      ]
    })
  }
)
