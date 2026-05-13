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
class TokenRequestBodyUnreadableError extends Error {}

const appendTokenRequestBodyChunk = (
  chunks: Uint8Array[],
  size: number,
  value: unknown
): number => {
  const chunk = toBodyChunk(value)
  const nextSize = size + chunk.byteLength
  if (nextSize > MAX_TOKEN_REQUEST_BODY_BYTES) {
    throw new TokenRequestBodyTooLargeError()
  }
  chunks.push(chunk)
  return nextSize
}

const toBodyChunk = (value: unknown): Uint8Array => {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (typeof value === 'number') return Uint8Array.of(value)
  if (typeof value === 'string') return Buffer.from(value)
  throw new TokenRequestBodyUnreadableError()
}

const getAsyncIterableBody = (
  body: ReadableStream<Uint8Array>
): AsyncIterable<Uint8Array> | null => {
  const asyncIterable = body as ReadableStream<Uint8Array> &
    AsyncIterable<Uint8Array>
  if (typeof asyncIterable[Symbol.asyncIterator] === 'function') {
    return asyncIterable
  }

  const valuesBody = body as ReadableStream<Uint8Array> & {
    values?: () => AsyncIterable<Uint8Array>
  }
  return typeof valuesBody.values === 'function' ? valuesBody.values() : null
}

const readTokenRequestBodyWithLimit = async (
  req: NextRequest
): Promise<string> => {
  const body = req.body
  if (!body) return ''
  const chunks: Uint8Array[] = []
  let size = 0

  if (typeof body.getReader === 'function') {
    const reader = body.getReader()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size = appendTokenRequestBodyChunk(chunks, size, value)
    }
  } else {
    const asyncIterableBody = getAsyncIterableBody(body)
    if (!asyncIterableBody) throw new TokenRequestBodyUnreadableError()

    for await (const value of asyncIterableBody) {
      size = appendTokenRequestBodyChunk(chunks, size, value)
    }
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
    if (error instanceof TokenRequestBodyUnreadableError) {
      return {
        bodyText: null,
        params: null,
        error: apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: {
            error: 'invalid_request',
            error_description: 'Unable to read request body'
          },
          responseStatusCode: HTTP_STATUS.BAD_REQUEST
        })
      }
    }

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
