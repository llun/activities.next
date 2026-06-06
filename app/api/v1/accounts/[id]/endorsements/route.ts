import { z } from 'zod'

import {
  OptionalOAuthGuard,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
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

      const endorsements = await database.getEndorsements({
        actorId: id,
        limit: parsed.data.limit
      })
      const accountsById = new Map(
        (
          await database.getMastodonActorsFromIds({
            ids: endorsements.map((e) => e.targetActorId)
          })
        ).map((account) => [account.url, account])
      )
      const accounts = endorsements
        .map((e) => accountsById.get(e.targetActorId))
        .filter((account): account is NonNullable<typeof account> =>
          Boolean(account)
        )

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: accounts
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
