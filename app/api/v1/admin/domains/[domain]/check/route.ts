import { readDomainRouteParam } from '@/lib/services/domains/adminDomainTypes'
import { recheckDomain } from '@/lib/services/domains/adminDomains'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import { normalizeServedDomainChoice } from '@/lib/utils/host'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_404,
  HTTP_STATUS,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

type Params = { domain: string }

// "Check again" for a domain an admin added: runs the reachability check and
// stores the result. It never turns the domain on or off.
const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'adminCheckDomain',
  AdminApiGuard<Params>(CORS_HEADERS, async (req, { database, params }) => {
    const domain = normalizeServedDomainChoice(
      readDomainRouteParam((await params).domain)
    )
    const item = domain ? await recheckDomain(database, domain) : null
    if (!item) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: HTTP_STATUS.NOT_FOUND
      })
    }
    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: item })
  })
)
