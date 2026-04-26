import { NextRequest } from 'next/server'

import {
  DomainBlockRequest,
  readRequestData
} from '@/app/api/v1/admin/domain_blocks/schema'
import { toAdminDomainBlock } from '@/lib/services/federation/domainRules'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
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

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'adminListDomainBlocks',
  AdminApiGuard(CORS_HEADERS, async (req: NextRequest, { database }) => {
    const blocks = await database.getDomainBlocks({ limit: 10_000 })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: blocks.map(toAdminDomainBlock)
    })
  })
)

export const POST = traceApiRoute(
  'adminCreateDomainBlock',
  AdminApiGuard(CORS_HEADERS, async (req: NextRequest, { database }) => {
    let data: unknown
    try {
      data = await readRequestData(req)
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
