import { z } from 'zod'

import { Scope } from '@/lib/database/types/oauth'
import { StatusType } from '@/lib/models/status'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
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

const StatusQueryParams = z.object({
  max_id: z.string().optional(),
  since_id: z.string().optional(),
  min_id: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).default(20).optional(),
  only_media: z.enum(['true', 'false']).optional(),
  exclude_replies: z.enum(['true', 'false']).optional(),
  exclude_reblogs: z.enum(['true', 'false']).optional(),
  pinned: z.enum(['true', 'false']).optional(),
  tagged: z.string().optional()
})

export const GET = OAuthGuard<Params>(
  [Scope.enum.read],
  async (req, context, params) => {
    const encodedAccountId = (await params?.params).id
    if (!encodedAccountId) {
      return apiErrorResponse(400)
    }

    const { database } = context
    const id = idToUrl(encodedAccountId)

    const actor = await database.getMastodonActorFromId({
      id
    })
    if (!actor) {
      return apiErrorResponse(404)
    }

    const url = new URL(req.url)
    const queryParams = Object.fromEntries(url.searchParams.entries())
    const parsedParams = StatusQueryParams.parse(queryParams)

    const {
      limit = 20,
      max_id: maxId,
      min_id: minId,
      since_id: sinceId,
      only_media: onlyMedia,
      exclude_replies: excludeReplies,
      exclude_reblogs: excludeReblogs,
      pinned,
      tagged
    } = parsedParams

    if (tagged) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: []
      })
    }

    if (pinned === 'true') {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: []
      })
    }

    const statuses = await database.getActorStatuses({
      actorId: id,
      maxStatusId: maxId,
      minStatusId: minId || sinceId,
      limit: limit + 1
    })

    let filteredStatuses = statuses

    if (onlyMedia === 'true') {
      filteredStatuses = filteredStatuses.filter((status) => {
        if (
          status.type === StatusType.enum.Note ||
          status.type === StatusType.enum.Poll
        ) {
          return status.attachments && status.attachments.length > 0
        }
        return false
      })
    }

    if (excludeReplies === 'true') {
      filteredStatuses = filteredStatuses.filter((status) => {
        if (
          status.type === StatusType.enum.Note ||
          status.type === StatusType.enum.Poll
        ) {
          return !status.reply
        }
        return true
      })
    }

    if (excludeReblogs === 'true') {
      filteredStatuses = filteredStatuses.filter(
        (status) => status.type !== StatusType.enum.Announce
      )
    }

    const hasMore = filteredStatuses.length > limit

    if (hasMore) {
      filteredStatuses = filteredStatuses.slice(0, limit)
    }

    const mastodonStatuses = await Promise.all(
      filteredStatuses.map((status) => getMastodonStatus(database, status))
    )

    const validMastodonStatuses = mastodonStatuses.filter(
      (status) => status !== null
    )

    const host = headerHost(req.headers)
    const pathBase = `/api/v1/accounts/${encodedAccountId}/statuses`

    const nextLink =
      validMastodonStatuses.length > 0 && hasMore
        ? `<https://${host}${pathBase}?limit=${limit}&max_id=${validMastodonStatuses[validMastodonStatuses.length - 1].id}>; rel="next"`
        : null

    const prevLink =
      validMastodonStatuses.length > 0
        ? `<https://${host}${pathBase}?limit=${limit}&min_id=${validMastodonStatuses[0].id}>; rel="prev"`
        : null

    const links = [nextLink, prevLink].filter(Boolean).join(', ')

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: validMastodonStatuses,
      additionalHeaders: [
        ...(links.length > 0 ? [['Link', links] as [string, string]] : [])
      ]
    })
  }
)
