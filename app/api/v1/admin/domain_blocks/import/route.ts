import { NextRequest } from 'next/server'

import {
  KnownDomainBlocklistSourceId,
  fetchKnownDomainBlocklist
} from '@/lib/services/federation/blocklistSources'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  ERROR_422,
  HTTP_STATUS,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'adminImportDomainBlocks',
  AdminApiGuard(CORS_HEADERS, async (req: NextRequest, { database }) => {
    const body = await req.json().catch(() => ({}))
    const parsed = KnownDomainBlocklistSourceId.safeParse(body.source)
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
      })
    }

    const blocks = await fetchKnownDomainBlocklist(parsed.data)
    const result = await database.importDomainBlocks({ blocks })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: {
        source: parsed.data,
        fetched: blocks.length,
        ...result
      }
    })
  })
)
