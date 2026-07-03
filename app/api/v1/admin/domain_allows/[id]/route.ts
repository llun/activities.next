import { toAdminDomainAllow } from '@/lib/services/federation/domainRules'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_404,
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
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'adminGetDomainAllow',
  AdminApiGuard<Params>(
    CORS_HEADERS,
    async (req, { database, params }) => {
      const { id } = await params
      const allow = await database.getDomainAllowById(id)
      if (!allow) {
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
        data: toAdminDomainAllow(allow)
      })
    },
    { resource: 'domain_allows' }
  )
)

export const DELETE = traceApiRoute(
  'adminDeleteDomainAllow',
  AdminApiGuard<Params>(
    CORS_HEADERS,
    async (req, { database, params }) => {
      const { id } = await params
      const allow = await database.deleteDomainAllow(id)
      if (!allow) {
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
        data: toAdminDomainAllow(allow)
      })
    },
    { resource: 'domain_allows' }
  )
)
