import { z } from 'zod'

import { OptionalOAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { canActorReadStatus } from '@/lib/services/statusAccess'
import { Mastodon } from '@/lib/types/activitypub'
import { Scope } from '@/lib/types/database/operations'
import { FollowStatus } from '@/lib/types/domain/follow'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  ERROR_400,
  ERROR_404,
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

const StatusQueryParams = z.object({
  max_id: z.string().optional(),
  since_id: z.string().optional(),
  min_id: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).default(20).optional(),
  only_media: z
    .enum(['true', 'false', '1', '0'])
    .transform((val) => val === 'true' || val === '1')
    .optional(),
  exclude_replies: z
    .enum(['true', 'false', '1', '0'])
    .transform((val) => val === 'true' || val === '1')
    .optional(),
  exclude_reblogs: z
    .enum(['true', 'false', '1', '0'])
    .transform((val) => val === 'true' || val === '1')
    .optional(),
  pinned: z
    .enum(['true', 'false', '1', '0'])
    .transform((val) => val === 'true' || val === '1')
    .optional(),
  tagged: z.string().optional()
})

export const GET = traceApiRoute(
  'getAccountStatuses',
  OptionalOAuthGuard<Params>([Scope.enum.read], async (req, context) => {
    const { database, currentActor, params } = context
    const encodedAccountId = (await params).id
    if (!encodedAccountId) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }
    const id = idToUrl(encodedAccountId)

    const actor = await database.getMastodonActorFromId({ id })
    if (!actor) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })
    }

    const url = new URL(req.url)
    const queryParams = Object.fromEntries(url.searchParams.entries())
    const parsed = StatusQueryParams.safeParse(queryParams)
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }
    const parsedParams = parsed.data

    const {
      limit = 20,
      max_id: maxId,
      min_id: minId,
      since_id: sinceId
    } = parsedParams

    const follow =
      currentActor && currentActor.id !== id
        ? await database.getAcceptedOrRequestedFollow({
            actorId: currentActor.id,
            targetActorId: id
          })
        : null
    const isFollower =
      currentActor && currentActor.id !== id
        ? follow?.status === FollowStatus.enum.Accepted
        : undefined
    const isOwner = currentActor?.id === id
    const statuses = await database.getActorStatuses({
      actorId: id,
      maxStatusId: maxId,
      minStatusId: minId || sinceId,
      limit,
      publicOnly: currentActor === null,
      visibleToActorId: currentActor && !isOwner ? currentActor.id : undefined,
      includeFollowersOnly: isFollower
    })
    const readableStatuses = (
      await Promise.all(
        statuses.map(async (status) =>
          (await canActorReadStatus({
            database,
            status,
            currentActor,
            isFollower
          }))
            ? status
            : null
        )
      )
    ).filter((status): status is (typeof statuses)[number] => status !== null)

    const mastodonStatuses = (
      await Promise.all(
        readableStatuses.map((status) =>
          getMastodonStatus(database, status, currentActor?.id)
        )
      )
    ).filter((status): status is Mastodon.Status => status !== null)

    const host = headerHost(req.headers)
    const pathBase = `/api/v1/accounts/${encodedAccountId}/statuses`

    const nextLink =
      mastodonStatuses.length > 0
        ? `<https://${host}${pathBase}?limit=${limit}&max_id=${mastodonStatuses[mastodonStatuses.length - 1].id}>; rel="next"`
        : null

    const prevLink =
      mastodonStatuses.length > 0
        ? `<https://${host}${pathBase}?limit=${limit}&min_id=${mastodonStatuses[0].id}>; rel="prev"`
        : null

    const links = [nextLink, prevLink].filter(Boolean).join(', ')

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: mastodonStatuses,
      additionalHeaders: [
        ...(links.length > 0 ? [['Link', links] as [string, string]] : [])
      ]
    })
  }),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)
