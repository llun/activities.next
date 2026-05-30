import { OAuthGuard, corsErrorResponse } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

export const GET = traceApiRoute(
  'getAnnouncements',
  OAuthGuard<{}>(
    [Scope.enum.read],
    async (req) => {
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: [] })
    },
    guardOptions
  )
)
