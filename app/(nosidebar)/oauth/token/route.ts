import { NextRequest } from 'next/server'

import { getBaseURL } from '@/lib/config'
import { getKnex } from '@/lib/database'
import { getAuth } from '@/lib/services/auth/auth'
import {
  oauthLogger,
  sanitizeFormBody,
  sanitizeHeaders,
  sanitizeParams
} from '@/lib/services/oauth/logging'
import { HttpMethod } from '@/lib/utils/http-headers'
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
const MULTIPART_FORM_MEDIA_TYPE = 'multipart/form-data'
const JSON_MEDIA_TYPE = 'application/json'
// Native Mastodon clients are inconsistent about how they encode the token
// request: Ivory posts `multipart/form-data`, others post JSON, the spec default
// is `application/x-www-form-urlencoded`. Accept all three and normalize the
// non-urlencoded ones to urlencoded before forwarding, since better-auth's token
// handler only parses urlencoded/JSON — not multipart boundaries.
const ACCEPTED_TOKEN_MEDIA_TYPES = new Set([
  FORM_URLENCODED_MEDIA_TYPE,
  MULTIPART_FORM_MEDIA_TYPE,
  JSON_MEDIA_TYPE
])
// `cookie` is stripped so a forwarded browser session cookie does not trigger
// better-auth's cookie-gated CSRF origin check on the token back-channel. Native
// OAuth clients (e.g. the Mastodon iOS app) send no Origin header, so leaving the
// cookie in place makes better-auth reject the request with MISSING_OR_NULL_ORIGIN.
// The token endpoint is authenticated by client credentials / PKCE, not cookies.
const TOKEN_PROXY_EXCLUDED_HEADERS = ['content-length', 'host', 'cookie']
const BASIC_CREDENTIALS_PATTERN = /^basic\s+([A-Za-z0-9+/]+={0,2})$/i

export const OPTIONS = defaultOptions(CORS_HEADERS)

const normalizeBase64Credentials = (credentials: string): string | null => {
  const paddingLength = credentials.length % 4
  if (paddingLength === 0) return credentials
  if (credentials.includes('=') || paddingLength === 1) return null

  return `${credentials}${'='.repeat(4 - paddingLength)}`
}

const parseBasicClientId = (authorization: string | null): string | null => {
  const credentials = authorization?.match(BASIC_CREDENTIALS_PATTERN)?.[1]
  if (!credentials) return null

  const normalizedCredentials = normalizeBase64Credentials(credentials)
  if (!normalizedCredentials) return null

  try {
    const decoded = Buffer.from(normalizedCredentials, 'base64').toString(
      'utf8'
    )
    const delimiterIndex = decoded.indexOf(':')
    if (delimiterIndex < 0) return null

    const clientId = decoded.slice(0, delimiterIndex)
    return clientId || null
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
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new TokenRequestBodyUnreadableError()
    }
    return Uint8Array.of(value)
  }
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

// OAuth token parameters are flat string fields, so flatten any JSON body into
// urlencoded params and drop non-primitive values. A body that parses to a
// non-object (null, array, string, number) is not a valid token request, so it
// is rejected rather than silently forwarded as an empty urlencoded body.
const jsonBodyToParams = (parsed: unknown): URLSearchParams => {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TokenRequestBodyUnreadableError()
  }
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(parsed)) {
    if (value === null || value === undefined || typeof value === 'object') {
      continue
    }
    params.set(key, String(value))
  }
  return params
}

const parseMultipartBoundary = (rawContentType: string): string | null => {
  const match = rawContentType.match(/;\s*boundary=(?:"([^"]+)"|([^;]+))/i)
  const boundary = (match?.[1] ?? match?.[2])?.trim()
  return boundary || null
}

// Minimal multipart/form-data parser for the simple named text fields an OAuth
// token request carries. The platform `Response.formData()` parser is not used
// because it is unavailable in the test runtime; token bodies never contain file
// parts, so those (Content-Disposition with a `filename`) are skipped.
const multipartBodyToParams = (
  rawContentType: string,
  bodyText: string
): URLSearchParams => {
  const boundary = parseMultipartBoundary(rawContentType)
  if (!boundary) throw new TokenRequestBodyUnreadableError()

  const delimiter = `--${boundary}`
  // A body that never contains its declared boundary is malformed; reject it
  // rather than forwarding an empty (and silently wrong) urlencoded body.
  if (!bodyText.includes(delimiter)) {
    throw new TokenRequestBodyUnreadableError()
  }

  // Be lenient about line endings: multipart is CRLF per RFC 2046, but some
  // clients, proxies, and test harnesses emit LF. Normalize to LF before
  // splitting so both are parsed identically.
  const normalizedBody = bodyText.replace(/\r\n/g, '\n')

  const params = new URLSearchParams()
  for (const rawSegment of normalizedBody.split(delimiter)) {
    const segment = rawSegment.startsWith('\n')
      ? rawSegment.slice(1)
      : rawSegment
    const headerEnd = segment.indexOf('\n\n')
    if (headerEnd < 0) continue

    const disposition = segment
      .slice(0, headerEnd)
      .split('\n')
      .find((line) => line.toLowerCase().startsWith('content-disposition:'))
    if (!disposition || /;\s*filename=/i.test(disposition)) continue

    const name = disposition.match(/;\s*name="?([^";]+)"?/i)?.[1]
    if (!name) continue

    const value = segment.slice(headerEnd + 2)
    params.set(name, value.endsWith('\n') ? value.slice(0, -1) : value)
  }
  return params
}

// Normalize a token request body to urlencoded params. urlencoded bodies are
// forwarded verbatim (the production-proven path); multipart/JSON bodies are
// re-serialized to urlencoded and signal a content-type override for the proxy.
// Malformed JSON / multipart bodies raise TokenRequestBodyUnreadableError so the
// caller maps them to the existing 400.
const normalizeTokenRequestBody = (
  mediaType: string,
  rawContentType: string,
  bodyText: string
): {
  params: URLSearchParams
  forwardBodyText: string
  forwardContentType: string | null
} => {
  if (mediaType === FORM_URLENCODED_MEDIA_TYPE) {
    return {
      params: new URLSearchParams(bodyText),
      forwardBodyText: bodyText,
      forwardContentType: null
    }
  }

  try {
    const params =
      mediaType === JSON_MEDIA_TYPE
        ? jsonBodyToParams(JSON.parse(bodyText))
        : multipartBodyToParams(rawContentType, bodyText)
    return {
      params,
      forwardBodyText: params.toString(),
      forwardContentType: FORM_URLENCODED_MEDIA_TYPE
    }
  } catch (error) {
    if (error instanceof TokenRequestBodyUnreadableError) throw error
    throw new TokenRequestBodyUnreadableError()
  }
}

const getTokenProxyHeaders = (headers: Headers): Headers => {
  const proxyHeaders = new Headers(headers)
  for (const header of TOKEN_PROXY_EXCLUDED_HEADERS) {
    proxyHeaders.delete(header)
  }
  return proxyHeaders
}

const getTokenRequestBody = async (
  req: NextRequest
): Promise<{
  bodyText: string | null
  params: URLSearchParams | null
  forwardContentType: string | null
  error: Response | null
}> => {
  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (contentLength > MAX_TOKEN_REQUEST_BODY_BYTES) {
    return {
      bodyText: null,
      params: null,
      forwardContentType: null,
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

  const rawContentType = req.headers.get('content-type') ?? ''
  const mediaType = rawContentType.split(';')[0].trim().toLowerCase()

  if (!ACCEPTED_TOKEN_MEDIA_TYPES.has(mediaType)) {
    return {
      bodyText: null,
      params: null,
      forwardContentType: null,
      error: apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          error: 'invalid_request',
          error_description:
            'Token requests must use application/x-www-form-urlencoded, multipart/form-data, or application/json'
        },
        responseStatusCode: HTTP_STATUS.BAD_REQUEST
      })
    }
  }

  try {
    const bodyText = await readTokenRequestBodyWithLimit(req)
    const { params, forwardBodyText, forwardContentType } =
      normalizeTokenRequestBody(mediaType, rawContentType, bodyText)
    return {
      bodyText: forwardBodyText,
      params,
      forwardContentType,
      error: null
    }
  } catch (error) {
    if (error instanceof TokenRequestBodyUnreadableError) {
      return {
        bodyText: null,
        params: null,
        forwardContentType: null,
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
      forwardContentType: null,
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
    oauthLogger.error(
      { endpoint: 'token', reason: 'pkce_preflight', err: e },
      'PKCE token preflight failed'
    )
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
    responseStatusCode: HTTP_STATUS.BAD_REQUEST
  })
}

export const POST = async (req: NextRequest) => {
  const auth = getAuth()

  oauthLogger.debug(
    {
      endpoint: 'token',
      headers: sanitizeHeaders(req.headers)
    },
    'OAuth token request received'
  )

  const { bodyText, params, forwardContentType, error } =
    await getTokenRequestBody(req)
  if (error) {
    // Pre-flight rejection (wrong content-type, oversized/unreadable body).
    // These are the proxy's own 4xx responses and never reach better-auth.
    oauthLogger.warn(
      {
        endpoint: 'token',
        status: error.status,
        reason: 'request_body',
        headers: sanitizeHeaders(req.headers)
      },
      `OAuth token request rejected with ${error.status}`
    )
    return error
  }

  if (params) {
    const pkceError = await validatePkceTokenExchange(req, params)
    if (pkceError) {
      oauthLogger.warn(
        {
          endpoint: 'token',
          status: pkceError.status,
          reason: 'pkce',
          headers: sanitizeHeaders(req.headers),
          requestBody: sanitizeFormBody(bodyText ?? '')
        },
        `OAuth token request rejected with ${pkceError.status}`
      )
      return pkceError
    }
  }

  // Rewrite the URL to better-auth's token endpoint
  const url = new URL('/api/auth/oauth2/token', getBaseURL())
  const proxyHeaders = getTokenProxyHeaders(req.headers)
  // multipart/JSON bodies were normalized to urlencoded; override the forwarded
  // content-type to match so better-auth parses the body it actually receives.
  if (forwardContentType) {
    proxyHeaders.set('content-type', forwardContentType)
  }
  const proxyReq = new Request(url.toString(), {
    method: 'POST',
    headers: proxyHeaders,
    body: bodyText ?? ''
  })

  let response: Response
  try {
    response = await auth.handler(proxyReq)
  } catch (e) {
    oauthLogger.error(
      { endpoint: 'token', reason: 'handler_threw', err: e },
      'Token endpoint handler threw'
    )
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

  // Log token exchanges better-auth rejected so 400s from third-party Mastodon
  // clients can be diagnosed in production: the request the client sent (secrets
  // redacted) plus the upstream OAuth error body (e.g. invalid_grant /
  // invalid_client). The error body is non-secret OAuth metadata, but it is run
  // through sanitizeParams as defense-in-depth in case an upstream error ever
  // echoes back a sensitive field.
  if (!response.ok) {
    oauthLogger.warn(
      {
        endpoint: 'token',
        status: statusCode,
        reason: 'upstream',
        headers: sanitizeHeaders(req.headers),
        requestBody: sanitizeFormBody(bodyText ?? ''),
        upstreamBody: sanitizeParams(data)
      },
      `OAuth token request failed with ${statusCode}`
    )
  }

  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: response.ok
      ? { ...data, created_at: Math.floor(Date.now() / 1000) }
      : data,
    responseStatusCode: statusCode
  })
}
