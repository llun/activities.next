import { NextRequest } from 'next/server'

import { DomainBlockUpdateRequest } from '@/app/api/v1/admin/domain_blocks/schema'
import { toAdminDomainBlock } from '@/lib/services/federation/domainRules'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import { getRequestBody } from '@/lib/utils/getRequestBody'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_400,
  ERROR_404,
  ERROR_422,
  HTTP_STATUS,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

type Params = {
  id: string
}

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.PUT,
  HttpMethod.enum.PATCH,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'adminGetDomainBlock',
  AdminApiGuard<Params>(
    CORS_HEADERS,
    async (req, { database, params }) => {
      const { id } = await params
      const block = await database.getDomainBlockById(id)
      if (!block) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: HTTP_STATUS.NOT_FOUND
        })
      }

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: toAdminDomainBlock(block)
      })
    },
    { resource: 'domain_blocks' }
  )
)

export const PUT = traceApiRoute(
  'adminUpdateDomainBlock',
  AdminApiGuard<Params>(
    CORS_HEADERS,
    async (req: NextRequest, { database, params }) => {
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

      const parsed = DomainBlockUpdateRequest.safeParse(data)
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
        })
      }

      const { id } = await params
      const block = await database.updateDomainBlock({
        id,
        severity: parsed.data.severity,
        rejectMedia: parsed.data.reject_media,
        rejectReports: parsed.data.reject_reports,
        privateComment: parsed.data.private_comment,
        publicComment: parsed.data.public_comment,
        obfuscate: parsed.data.obfuscate
      })
      if (!block) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: HTTP_STATUS.NOT_FOUND
        })
      }

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: toAdminDomainBlock(block)
      })
    },
    { resource: 'domain_blocks' }
  )
)

// Rails `resources` maps update to both PATCH and PUT; Mastodon clients commonly
// send PATCH. Bind PATCH to the same handler so it does not 405.
export const PATCH = PUT

export const DELETE = traceApiRoute(
  'adminDeleteDomainBlock',
  AdminApiGuard<Params>(
    CORS_HEADERS,
    async (req, { database, params }) => {
      const { id } = await params
      const block = await database.deleteDomainBlock(id)
      if (!block) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: HTTP_STATUS.NOT_FOUND
        })
      }

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: toAdminDomainBlock(block)
      })
    },
    { resource: 'domain_blocks' }
  )
)
