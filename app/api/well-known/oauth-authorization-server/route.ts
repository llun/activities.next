import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { resolveAuthBaseURL } from '@/lib/services/auth/requestOrigin'
import { getOAuthAuthorizationServerMetadata } from '@/lib/services/wellknown'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'oauthAuthorizationServer',
  async (req: NextRequest) => {
    // Advertise the host the request arrived on (validated against trusted
    // hosts) so a client discovering metadata on a served alias domain isn't
    // bounced to the canonical host. Matches better-auth's per-request baseURL.
    const baseURL = resolveAuthBaseURL(req.headers, getConfig())
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: getOAuthAuthorizationServerMetadata(baseURL)
    })
  }
)
