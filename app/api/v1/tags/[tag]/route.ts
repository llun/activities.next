import { NextRequest } from 'next/server'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { cleanJson } from '@/lib/utils/cleanJson'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl, urlToId } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const Params = z.object({
  tag: z.string().min(1)
})

interface RouteParams {
  tag: string
}

export const GET = traceApiRoute(
  'getHashtagTimeline',
  async (req: NextRequest, context: { params: Promise<RouteParams> }) => {
    const database = getDatabase()
    if (!database) return apiErrorResponse(500)

    const params = await context.params
    const parseResult = Params.safeParse(params)
    if (!parseResult.success) return apiErrorResponse(400)

    const { tag } = parseResult.data
    const url = new URL(req.url)
    const maxStatusIdParam = url.searchParams.get('max_id')
    const limit = url.searchParams.get('limit')
    const format = url.searchParams.get('format')

    const statuses = await database.getStatusesByHashtag({
      hashtag: tag,
      limit: limit ? parseInt(limit, 10) : PER_PAGE_LIMIT,
      maxStatusId: maxStatusIdParam ? idToUrl(maxStatusIdParam) : undefined
    })

    if (format === 'activities_next') {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          statuses: statuses.map((item) => cleanJson(item))
        }
      })
    }

    const host = headerHost(req.headers)
    const nextLink =
      statuses.length > 0
        ? `<https://${host}/api/v1/tags/${tag}?limit=20&max_id=${urlToId(statuses[statuses.length - 1].id)}>; rel="next"`
        : null
    const prevLink =
      statuses.length > 0
        ? `<https://${host}/api/v1/tags/${tag}?limit=20&min_id=${urlToId(statuses[0].id)}>; rel="prev"`
        : null
    const links = [nextLink, prevLink].filter(Boolean).join(', ')
    const mastodonStatuses = await Promise.all(
      statuses.map((item) => getMastodonStatus(database, item))
    )

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: mastodonStatuses.filter(Boolean),
      additionalHeaders: [
        ...(links.length > 0 ? [['Link', links] as [string, string]] : [])
      ]
    })
  },
  {
    addAttributes: async (_req, context) => {
      const { tag } = await context.params
      return { tag }
    }
  }
)
