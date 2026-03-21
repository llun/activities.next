import { NextRequest } from 'next/server'

import { getAuth } from '@/lib/services/auth/auth'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  StatusCode,
  apiResponse,
  codeMap,
  defaultOptions
} from '@/lib/utils/response'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = async (req: NextRequest) => {
  const auth = getAuth()

  // Rewrite the URL to better-auth's token endpoint
  const url = new URL('/api/auth/oauth2/token', req.url)
  const proxyReq = new Request(url.toString(), {
    method: 'POST',
    headers: req.headers,
    body: req.body,
    // @ts-expect-error duplex is needed for streaming body
    duplex: 'half'
  })

  const response = await auth.handler(proxyReq)

  let data: Record<string, unknown> = {}
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      data = (await response.json()) as Record<string, unknown>
    } catch {
      // Non-parseable body; data remains empty
    }
  }

  const statusCode = (
    response.status in codeMap ? response.status : 500
  ) as StatusCode

  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: response.ok
      ? { ...data, created_at: Math.floor(Date.now() / 1000) }
      : data,
    responseStatusCode: statusCode
  })
}
