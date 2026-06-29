import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { resolveAuthBaseURL } from '@/lib/services/auth/requestOrigin'
import { getOpenIDConfiguration } from '@/lib/services/wellknown'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'openidConfiguration',
  async (req: NextRequest) => {
    // Advertise the issuer/endpoints for the host the request arrived on
    // (validated against trusted hosts) so a discovery-based relying party on a
    // served alias domain gets an `issuer` matching the id_token `iss`
    // better-auth signs for that same host.
    const baseURL = resolveAuthBaseURL(req.headers, getConfig())
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: getOpenIDConfiguration(baseURL)
    })
  }
)
