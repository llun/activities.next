import { z } from 'zod'

import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
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

const FavouritedByQueryParams = z.object({
  limit: z.coerce.number().min(1).max(200).optional(),
  offset: z.coerce.number().min(0).default(0).optional()
})

export const GET = traceApiRoute(
  'getStatusFavouritedBy',
  OAuthGuard<Params>([Scope.enum.read], async (req, context) => {
    const { database, params } = context
    const encodedStatusId = (await params).id
    if (!encodedStatusId) return apiErrorResponse(404)

    const queryParams = Object.fromEntries(new URL(req.url).searchParams)
    const parsedParams = FavouritedByQueryParams.safeParse(queryParams)
    if (!parsedParams.success) {
      return apiErrorResponse(400)
    }

    const { limit, offset = 0 } = parsedParams.data
    const statusId = idToUrl(encodedStatusId)
    const [actors, totalCount] = await Promise.all([
      database.getFavouritedBy({ statusId, limit, offset }),
      database.getLikeCount({ statusId })
    ])

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: await Promise.all(
        actors.map((actor) => database.getMastodonActorFromId({ id: actor.id }))
      ),
      additionalHeaders: [
        ['X-Total-Count', `${totalCount}`],
        ['X-Offset', `${offset}`],
        ['X-Limit', `${limit ?? totalCount}`]
      ]
    })
  }),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { statusId: params?.id || 'unknown' }
    }
  }
)
