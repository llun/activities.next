import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]
const MAX_LIMIT = 80

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'getBlocks',
  OAuthGuard([Scope.enum.read], async (req, { database, currentActor }) => {
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
      minId: url.searchParams.get('min_id') || url.searchParams.get('since_id')
    })

    const accounts = await Promise.all(
      blocks.map((block) =>
        database.getMastodonActorFromId({ id: block.targetActorId })
      )
    )

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: accounts.filter(Boolean)
    })
  })
)
