import { NextRequest } from 'next/server'

import { getBaseURL } from '@/lib/config'
import { getKnex } from '@/lib/database'
import { getAuth } from '@/lib/services/auth/auth'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { logger } from '@/lib/utils/logger'
import {
  HTTP_STATUS,
  StatusCode,
  apiResponse,
  codeMap,
  defaultOptions
} from '@/lib/utils/response'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]
const MAX_TOKEN_REQUEST_BODY_BYTES = 64 * 1024
const FORM_URLENCODED_MEDIA_TYPE = 'application/x-www-form-urlencoded'

export const OPTIONS = defaultOptions(CORS_HEADERS)

const parseBasicClientId = (authorization: string | null): string | null => {
  const [scheme, credentials] = authorization?.split(/\s+/, 2) ?? []
  if (scheme?.toLowerCase() !== 'basic' || !credentials) return null

  try {
    const decoded = Buffer.from(credentials, 'base64')
      .toString('utf8')
      .split(':')[0]
    return decoded || null
  } catch {
    return null
  }
}

const getClientId = (
  req: NextRequest,
  body: URLSearchParams
): string | null => {
  const basicClientId = parseBasicClientId(req.headers.get('authorization'))
  return basicClientId || body.get('client_id')
}

class TokenRequestBodyTooLargeError extends Error {}

const readTokenRequestBodyWithLimit = async (
  req: NextRequest
): Promise<string> => {
  const body = req.body
  if (!body) return ''
  if (typeof body.getReader !== 'function') {
    const bodyBuffer = Buffer.from(await req.arrayBuffer())
    if (bodyBuffer.byteLength > MAX_TOKEN_REQUEST_BODY_BYTES) {
      throw new TokenRequestBodyTooLargeError()
    }
    return bodyBuffer.toString('utf8')
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_TOKEN_REQUEST_BODY_BYTES) {
      throw new TokenRequestBodyTooLargeError()
    }
    chunks.push(value)
  }

  return Buffer.concat(chunks).toString('utf8')
}

const getTokenRequestBody = async (
  req: NextRequest
): Promise<{
  bodyText: string | null
  params: URLSearchParams | null
  error: Response | null
}> => {
  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (contentLength > MAX_TOKEN_REQUEST_BODY_BYTES) {
    return {
      bodyText: null,
      params: null,
      error: apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          error: 'invalid_request',
          error_description: 'Request body is too large'
        },
        responseStatusCode: HTTP_STATUS.PAYLOAD_TOO_LARGE
      })
    }
  }

  const contentType = (req.headers.get('content-type') ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase()

  if (contentType !== FORM_URLENCODED_MEDIA_TYPE) {
    return {
      bodyText: null,
      params: null,
      error: apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          error: 'invalid_request',
          error_description:
            'Token requests must use application/x-www-form-urlencoded'
        },
        responseStatusCode: HTTP_STATUS.BAD_REQUEST
      })
    }
  }

  try {
    const bodyText = await readTokenRequestBodyWithLimit(req)
    return { bodyText, params: new URLSearchParams(bodyText), error: null }
  } catch (error) {
    if (!(error instanceof TokenRequestBodyTooLargeError)) throw error
    return {
      bodyText: null,
      params: null,
      error: apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          error: 'invalid_request',
          error_description: 'Request body is too large'
        },
        responseStatusCode: HTTP_STATUS.PAYLOAD_TOO_LARGE
      })
    }
  }
}

const validatePkceTokenExchange = async (
  req: NextRequest,
  body: URLSearchParams
): Promise<Response | null> => {
  if (body.get('grant_type') !== 'authorization_code') return null
  if (body.get('code_verifier')) return null

  const clientId = getClientId(req, body)
  if (!clientId) {
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { error: 'invalid_client' },
      responseStatusCode: HTTP_STATUS.UNAUTHORIZED
    })
  }

  try {
    const client = await getKnex()('oauthClient')
      .where('clientId', clientId)
      .first()
    if (!client?.requirePKCE) return null
  } catch (e) {
    logger.error({ message: 'PKCE token preflight failed', error: e })
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { error: 'server_error' },
      responseStatusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR
    })
  }

  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: {
      error: 'invalid_request',
      error_description: 'PKCE is required for this client'
    },
    responseStatusCode: 400
  })
}

export const POST = async (req: NextRequest) => {
  const auth = getAuth()
  const { bodyText, params, error } = await getTokenRequestBody(req)
  if (error) return error

  if (params) {
    const pkceError = await validatePkceTokenExchange(req, params)
    if (pkceError) return pkceError
  }

  // Rewrite the URL to better-auth's token endpoint
  const url = new URL('/api/auth/oauth2/token', getBaseURL())
  const proxyReq = new Request(url.toString(), {
    method: 'POST',
    headers: req.headers,
    body: bodyText ?? ''
  })

  let response: Response
  try {
    response = await auth.handler(proxyReq)
  } catch (e) {
    logger.error({ message: 'Token endpoint handler threw', error: e })
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { error: 'server_error' },
      responseStatusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR
    })
  }

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
    response.status in codeMap
      ? response.status
      : response.status >= 500
        ? 500
        : 400
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
