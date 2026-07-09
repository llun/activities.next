import { NextRequest } from 'next/server'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { toPublicDomainBlock } from '@/lib/services/federation/domainRules'
import { clampedLimit, clampedOffset } from '@/lib/utils/clampedLimit'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_400, HTTP_STATUS, apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.GET]
const DomainBlockListQueryParams = z.object({
  limit: clampedLimit(1000, 100),
  offset: clampedOffset()
})

export const GET = traceApiRoute(
  'getInstanceDomainBlocks',
  async (req: NextRequest) => {
    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Database unavailable' },
        responseStatusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR
      })
    }

    const queryParams = Object.fromEntries(new URL(req.url).searchParams)
    const parsedParams = DomainBlockListQueryParams.safeParse(queryParams)
    if (!parsedParams.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: HTTP_STATUS.BAD_REQUEST
      })
    }

    const { limit, offset } = parsedParams.data
    const [blocks, stats] = await Promise.all([
      // Mastodon lists every block with user-facing impact: silenced
      // (limited) domains as well as suspended ones. noop rows stay private.
      database.getDomainBlocks({
        limit,
        offset,
        severities: ['silence', 'suspend']
      }),
      database.getDomainFederationRuleStats()
    ])

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: blocks.map(toPublicDomainBlock),
      additionalHeaders: [
        ['X-Total-Count', `${stats.suspendBlocks + stats.silenceBlocks}`],
        ['X-Offset', `${offset}`],
        ['X-Limit', `${limit}`]
      ]
    })
  }
)
