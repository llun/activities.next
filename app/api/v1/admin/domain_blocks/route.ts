import { NextRequest } from 'next/server'
import { z } from 'zod'

import { DomainBlockRequest } from '@/app/api/v1/admin/domain_blocks/schema'
import { toAdminDomainBlock } from '@/lib/services/federation/domainRules'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import { getRequestBody } from '@/lib/utils/getRequestBody'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_400,
  ERROR_422,
  HTTP_STATUS,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST
]
const DomainRuleListQueryParams = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0)
})

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'adminListDomainBlocks',
  AdminApiGuard(CORS_HEADERS, async (req: NextRequest, { database }) => {
    const queryParams = Object.fromEntries(new URL(req.url).searchParams)
    const parsedParams = DomainRuleListQueryParams.safeParse(queryParams)
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
      database.getDomainBlocks({ limit, offset }),
      database.getDomainFederationRuleStats()
    ])

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: blocks.map(toAdminDomainBlock),
      additionalHeaders: [
        ['X-Total-Count', `${stats.blocks}`],
        ['X-Offset', `${offset}`],
        ['X-Limit', `${limit}`]
      ]
    })
  })
)

export const POST = traceApiRoute(
  'adminCreateDomainBlock',
  AdminApiGuard(CORS_HEADERS, async (req: NextRequest, { database }) => {
    let data: unknown
    try {
      data = await getRequestBody(req)
    } catch {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: HTTP_STATUS.BAD_REQUEST
      })
    }

    const parsed = DomainBlockRequest.safeParse(data)
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
      })
    }

    const block = await database.createDomainBlock({
      domain: parsed.data.domain,
      severity: parsed.data.severity,
      rejectMedia: parsed.data.reject_media,
      rejectReports: parsed.data.reject_reports,
      privateComment: parsed.data.private_comment,
      publicComment: parsed.data.public_comment,
      obfuscate: parsed.data.obfuscate,
      source: null
    })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: toAdminDomainBlock(block)
    })
  })
)
