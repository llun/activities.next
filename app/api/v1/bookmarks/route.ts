import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 40

export const OPTIONS = defaultOptions(CORS_HEADERS)

const normalizeLimit = (value: string | null) => {
  const parsed = parseInt(value || `${DEFAULT_LIMIT}`, 10)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return DEFAULT_LIMIT
  return Math.min(parsed, MAX_LIMIT)
}

export const GET = traceApiRoute(
  'getBookmarks',
  OAuthGuard<{}>([Scope.enum['read:bookmarks']], async (req, context) => {
    const { database, currentActor } = context
    const url = new URL(req.url)
    const limit = normalizeLimit(url.searchParams.get('limit'))
    const bookmarks = await database.getBookmarks({
      actorId: currentActor.id,
      limit,
      maxId: url.searchParams.get('max_id'),
      minId: url.searchParams.get('min_id'),
      sinceId: url.searchParams.get('since_id')
    })

    const statuses = await database.getStatusesByIds({
      statusIds: bookmarks.map((bookmark) => bookmark.statusId),
      currentActorId: currentActor.id,
      withReplies: false
    })
    const mastodonStatuses = (
      await Promise.all(
        statuses.map((status) =>
          getMastodonStatus(database, status, currentActor.id)
        )
      )
    ).filter(Boolean)

    const host = headerHost(req.headers)
    const buildPaginationUrl = (cursorParam: string, cursorValue: string) => {
      const params = new URLSearchParams()
      params.set('limit', limit.toString())
      params.set(cursorParam, cursorValue)

      return `<https://${host}/api/v1/bookmarks?${params.toString()}>; rel="${cursorParam === 'max_id' ? 'next' : 'prev'}"`
    }
    const nextLink =
      bookmarks.length === limit
        ? buildPaginationUrl('max_id', bookmarks[bookmarks.length - 1].id)
        : null
    const prevLink =
      bookmarks.length > 0
        ? buildPaginationUrl('min_id', bookmarks[0].id)
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
  })
)
