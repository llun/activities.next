import { NextRequest } from 'next/server'

import { getAuth } from '@/lib/services/auth/auth'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { logger } from '@/lib/utils/logger'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute('revokeToken', async (req: NextRequest) => {
  const auth = getAuth()

  // Rewrite the URL to better-auth's revoke endpoint
  const url = new URL('/api/auth/oauth2/revoke', req.url)
  const proxyReq = new Request(url.toString(), {
    method: 'POST',
    headers: req.headers,
    body: req.body,
    // @ts-expect-error duplex is needed for streaming body
    duplex: 'half'
  })

  try {
    const revokeResponse = await auth.handler(proxyReq)
    // Per RFC 7009 §2.2, return 200 for invalid/unknown tokens (treat as
    // already revoked). For server-side failures (5xx), propagate the error.
    if (revokeResponse.status >= 500) {
      logger.error({
        message: 'Token revocation failed',
        status: revokeResponse.status
      })
      return apiErrorResponse(500)
    }
  } catch (e) {
    logger.error({ message: 'Token revocation threw', error: e })
    return apiErrorResponse(500)
  }

  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: {}
  })
})
