import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { getFallbackBlockedAccount } from '@/lib/services/accounts/getFallbackBlockedAccount'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { buildPaginationLinkHeader } from '@/lib/utils/paginationLinkHeader'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]
const MAX_LIMIT = 80

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'getBlocks',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:blocks']],
    async (req, { database, currentActor }) => {
      const url = new URL(req.url)
      const parsedLimit = parseInt(
        url.searchParams.get('limit') || `${PER_PAGE_LIMIT}`,
        10
      )
      const limit =
        Number.isSafeInteger(parsedLimit) && parsedLimit > 0
          ? Math.min(parsedLimit, MAX_LIMIT)
          : PER_PAGE_LIMIT
      const blocks = await database.getBlocks({
        actorId: currentActor.id,
        limit,
        maxId: url.searchParams.get('max_id'),
        minId: url.searchParams.get('min_id'),
        sinceId: url.searchParams.get('since_id')
      })

      const accounts = await Promise.all(
        blocks.map(async (block) => {
          const account = await database.getMastodonActorFromId({
            id: block.targetActorId
          })
          return account ?? getFallbackBlockedAccount(block)
        })
      )
      const additionalHeaders = buildPaginationLinkHeader({
        host: headerHost(req.headers),
        path: '/api/v1/blocks',
        limit,
        nextMaxId:
          blocks.length === limit ? blocks[blocks.length - 1].id : null,
        prevMinId: blocks.length > 0 ? blocks[0].id : null
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: accounts,
        additionalHeaders
      })
    }
  )
)
