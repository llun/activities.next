import { getDatabase } from '@/lib/database'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonNotificationRequest } from '@/lib/services/notifications/getMastodonNotificationRequest'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_500, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]
const DEFAULT_LIMIT = 40
const MAX_LIMIT = 80

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'getNotificationRequests',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:notifications']],
    async (req, { currentActor }) => {
      const database = getDatabase()
      if (!database) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_500,
          responseStatusCode: 500
        })
      }

      const url = new URL(req.url)
      const parsedLimit = parseInt(url.searchParams.get('limit') ?? '', 10)
      const limit = Math.min(
        Math.max(1, Number.isNaN(parsedLimit) ? DEFAULT_LIMIT : parsedLimit),
        MAX_LIMIT
      )
      const parsedPage = parseInt(url.searchParams.get('page') ?? '', 10)
      const page = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage

      const maxIdParam = url.searchParams.get('max_id')
      const sinceIdParam =
        url.searchParams.get('since_id') ?? url.searchParams.get('min_id')

      let maxCursor: { updatedAt: number; sourceActorId: string } | undefined
      let sinceCursor: { updatedAt: number; sourceActorId: string } | undefined

      if (maxIdParam) {
        const sourceActorId = idToUrl(maxIdParam)
        const cursor = await database.getNotificationRequest({
          actorId: currentActor.id,
          sourceActorId
        })
        // Cursor not found (request was accepted/dismissed): return empty list
        // rather than falling back to page 1, which would cause clients to loop.
        if (!cursor) {
          return apiResponse({ req, allowedMethods: CORS_HEADERS, data: [] })
        }
        maxCursor = { updatedAt: cursor.updatedAt, sourceActorId }
      } else if (sinceIdParam) {
        const sourceActorId = idToUrl(sinceIdParam)
        const cursor = await database.getNotificationRequest({
          actorId: currentActor.id,
          sourceActorId
        })
        if (!cursor) {
          return apiResponse({ req, allowedMethods: CORS_HEADERS, data: [] })
        }
        sinceCursor = { updatedAt: cursor.updatedAt, sourceActorId }
      }

      const useCursor = maxCursor !== undefined || sinceCursor !== undefined
      const offset = useCursor ? 0 : (page - 1) * limit

      const requests = await database.getNotificationRequests({
        actorId: currentActor.id,
        limit,
        offset,
        maxCursor,
        sinceCursor
      })

      const data = (
        await Promise.all(
          requests.map((request) =>
            getMastodonNotificationRequest(database, request, currentActor.id)
          )
        )
      ).filter(Boolean)

      // Build Link headers so Mastodon clients can paginate with max_id/min_id.
      const host = headerHost(req.headers)
      const pathBase = '/api/v1/notifications/requests'
      const buildLink = (cursorParam: string, cursorValue: string) =>
        `<https://${host}${pathBase}?limit=${limit}&${cursorParam}=${cursorValue}>; rel="${cursorParam === 'max_id' ? 'next' : 'prev'}"`

      const nextLink =
        data.length > 0 ? buildLink('max_id', data[data.length - 1]!.id) : null
      const prevLink = data.length > 0 ? buildLink('min_id', data[0]!.id) : null
      const links = [nextLink, prevLink].filter(Boolean).join(', ')

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data,
        additionalHeaders: [
          ...(links.length > 0 ? [['Link', links] as [string, string]] : [])
        ]
      })
    }
  )
)
