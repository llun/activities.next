import { z } from 'zod'

import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_400, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const EndorsementsQueryParams = z.object({
  max_id: z.string().optional(),
  since_id: z.string().optional(),
  min_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(80).default(40)
})

// GET /api/v1/endorsements — accounts the current user has featured.
// https://docs.joinmastodon.org/methods/endorsements/
// Scope: read:accounts (satisfied by aggregate `read`).
export const GET = traceApiRoute(
  'getEndorsements',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:accounts']],
    async (req, context) => {
      const { database, currentActor } = context

      const url = new URL(req.url)
      const parsed = EndorsementsQueryParams.safeParse(
        Object.fromEntries(url.searchParams.entries())
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
      const forwardCursor = minId ?? sinceId

      const endorsements = await database.getEndorsements({
        actorId: currentActor.id,
        limit,
        maxId,
        minId: forwardCursor
      })
      // Normalize forward-cursor pages back to newest-first.
      const ordered = forwardCursor ? [...endorsements].reverse() : endorsements

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
        const buildLink = (cursorName: 'max_id' | 'min_id', value: string) => {
          const linkParams = new URLSearchParams()
          linkParams.set('limit', `${limit}`)
          linkParams.set(cursorName, value)
          return `<https://${host}/api/v1/endorsements?${linkParams.toString()}>; rel="${cursorName === 'max_id' ? 'next' : 'prev'}"`
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
    { errorResponse: corsErrorResponse(CORS_HEADERS) }
  )
)
