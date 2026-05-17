import { z } from 'zod'

import { OptionalOAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getReadableStatus } from '@/lib/services/statusRouteAccess'
import { type RebloggedByAccount, Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  ERROR_400,
  ERROR_404,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl, urlToId } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

const RebloggedByQueryParams = z.object({
  limit: z.coerce.number().int().min(1).max(80).default(40),
  max_id: z.string().min(1).optional(),
  since_id: z.string().min(1).optional()
})

const getPaginationLinkHeader = ({
  req,
  limit,
  reblogs
}: {
  req: Request
  limit: number
  reblogs: RebloggedByAccount[]
}) => {
  if (reblogs.length === 0) return undefined

  const requestUrl = new URL(req.url)
  const buildUrl = (cursor: 'max_id' | 'since_id', statusId: string) => {
    const params = new URLSearchParams()
    params.set('limit', `${limit}`)
    params.set(cursor, urlToId(statusId))

    const url = new URL(requestUrl.pathname, requestUrl.origin)
    url.search = params.toString()
    return url.toString()
  }

  const firstReblog = reblogs[0]
  const lastReblog = reblogs[reblogs.length - 1]
  return [
    `<${buildUrl('max_id', lastReblog.statusId)}>; rel="next"`,
    `<${buildUrl('since_id', firstReblog.statusId)}>; rel="prev"`
  ].join(', ')
}

export const GET = traceApiRoute(
  'getStatusRebloggedBy',
  OptionalOAuthGuard<Params>([Scope.enum.read], async (req, context) => {
    const { database, currentActor, params } = context
    const encodedStatusId = (await params).id
    if (!encodedStatusId)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })

    const queryParams = Object.fromEntries(new URL(req.url).searchParams)
    const parsedParams = RebloggedByQueryParams.safeParse(queryParams)
    if (!parsedParams.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }

    const { limit, max_id: maxId, since_id: sinceId } = parsedParams.data
    const statusId = idToUrl(encodedStatusId)
    const status = await getReadableStatus({
      database,
      statusId,
      currentActor,
      withReplies: false
    })
    if (!status)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })

    const reblogs = await database.getRebloggedBy({
      statusId,
      limit,
      maxStatusId: maxId ? idToUrl(maxId) : undefined,
      sinceStatusId: sinceId ? idToUrl(sinceId) : undefined,
      visibleToActorId: currentActor?.id ?? null
    })

    const paginationLink = getPaginationLinkHeader({ req, limit, reblogs })

    const accounts = (
      await Promise.all(
        reblogs.map(({ actor }) =>
          database.getMastodonActorFromId({ id: actor.id })
        )
      )
    ).filter((account): account is NonNullable<typeof account> =>
      Boolean(account)
    )

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: accounts,
      additionalHeaders: paginationLink ? [['Link', paginationLink]] : []
    })
  }),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { statusId: params?.id || 'unknown' }
    }
  }
)
