import { NextRequest } from 'next/server'

import {
  KnownDomainBlocklistSourceId,
  downloadKnownDomainBlocklist
} from '@/lib/services/federation/blocklistSources'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_400,
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
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: HTTP_STATUS.BAD_REQUEST
      })
    }

    const source =
      typeof body === 'object' && body !== null && 'source' in body
        ? body.source
        : undefined
    const parsed = KnownDomainBlocklistSourceId.safeParse(source)
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
      })
    }

    let blocks: Awaited<ReturnType<typeof downloadKnownDomainBlocklist>>
    let result: Awaited<ReturnType<typeof database.importDomainBlocks>>
    try {
      blocks = await downloadKnownDomainBlocklist(parsed.data)
      result = await database.importDomainBlocks({ blocks })
    } catch {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: HTTP_STATUS.BAD_REQUEST
      })
    }

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
