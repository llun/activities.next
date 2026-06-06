import { z } from 'zod'

import {
  OptionalOAuthGuard,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
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

const EndorsementsQueryParams = z.object({
  max_id: z.string().optional(),
  since_id: z.string().optional(),
  min_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(80).default(40)
})

// GET /api/v1/accounts/:id/endorsements — accounts the given account features.
// https://docs.joinmastodon.org/methods/accounts/#endorsements
// Public with optional auth; returns Account[].
export const GET = traceApiRoute(
  'getAccountEndorsements',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read, Scope.enum['read:accounts']],
    async (req, context) => {
      const { database, params } = context
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
      const actor = await database.getActorFromId({ id })
      if (!actor) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      const parsed = EndorsementsQueryParams.safeParse(
        Object.fromEntries(new URL(req.url).searchParams.entries())
      )
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }

      const {
        limit,
        max_id: maxId,
        min_id: minId,
        since_id: sinceId
      } = parsed.data

      const ordered = await database.getEndorsements({
        actorId: id,
        limit,
        maxId,
        minId,
        sinceId
      })
      const accountsById = new Map(
        (
          await database.getMastodonActorsFromIds({
            ids: ordered.map((e) => e.targetActorId)
          })
        ).map((account) => [account.url, account])
      )
      const accounts = ordered
        .map((e) => accountsById.get(e.targetActorId))
        .filter((account): account is NonNullable<typeof account> =>
          Boolean(account)
        )

      const host = headerHost(req.headers)
      const links: string[] = []
      if (host && ordered.length > 0) {
        const pathBase = `/api/v1/accounts/${encodedAccountId}/endorsements`
        const buildLink = (cursorName: 'max_id' | 'min_id', value: string) => {
          const linkParams = new URLSearchParams()
          linkParams.set('limit', `${limit}`)
          linkParams.set(cursorName, value)
          return `<https://${host}${pathBase}?${linkParams.toString()}>; rel="${cursorName === 'max_id' ? 'next' : 'prev'}"`
        }
        links.push(buildLink('max_id', ordered[ordered.length - 1].id))
        links.push(buildLink('min_id', ordered[0].id))
      }

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: accounts,
        additionalHeaders: links.length > 0 ? [['Link', links.join(', ')]] : []
      })
    },
    { errorResponse: corsErrorResponse(CORS_HEADERS), matchMode: 'any' }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)
