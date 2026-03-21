import { NextRequest } from 'next/server'

import { getAuth } from '@/lib/services/auth/auth'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { logger } from '@/lib/utils/logger'
import {
  StatusCode,
  apiResponse,
  codeMap,
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
    if (!revokeResponse.ok) {
      if (revokeResponse.status >= 500) {
        logger.error({
          message: 'Token revocation failed',
          status: revokeResponse.status
        })
      }
      // RFC 7009 §2.2 + RFC 6749 §5.2: propagate 4xx (e.g. 401 for
      // invalid client credentials, 400 for malformed requests) and 5xx.
      const errData = await revokeResponse.json().catch(() => ({}))
      const status = revokeResponse.status
      const mappedStatus: StatusCode =
        status in codeMap ? (status as StatusCode) : status >= 500 ? 500 : 400
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: errData,
        responseStatusCode: mappedStatus
      })
    }
  } catch (e) {
    logger.error({ message: 'Token revocation threw', error: e })
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: codeMap[500],
      responseStatusCode: 500
    })
  }

  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: {}
  })
})
