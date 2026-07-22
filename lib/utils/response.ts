import { SpanStatusCode, trace } from '@opentelemetry/api'
import { NextRequest } from 'next/server'

import { SERVICE_NAME } from '@/lib/constants'

import { HttpMethod, getCORSHeaders } from './http-headers'

// Mastodon serializes every error as `{ "error": "message" }`
// (https://docs.joinmastodon.org/entities/Error/). Emit that shape for all
// error responses so Mastodon-API clients (Phanpy, Elk, Tusky, the iOS app, …)
// can read the message: masto.js, for instance, derives an error's `message`
// from this `error` field and drops any other key into `additionalProperties`,
// so the old generic `{ status: … }` body left the message empty. The HTTP
// reason phrase used for the response `statusText` lives separately in
// `REASON_PHRASE`, so it stays correct regardless of the body shape.
export const ERROR_500 = { error: 'Internal Server Error' }

export const ERROR_400 = { error: 'Bad Request' }
export const ERROR_401 = { error: 'Unauthorized' }
export const ERROR_403 = { error: 'Forbidden' }
export const ERROR_404 = { error: 'Not Found' }
export const ERROR_409 = { error: 'Conflict' }
export const ERROR_410 = { error: 'Gone' }
export const ERROR_422 = { error: 'Unprocessable entity' }
export const ERROR_429 = { error: 'Too Many Requests' }
export const ERROR_413 = { error: 'Payload Too Large' }
export const ERROR_501 = { error: 'Not Implemented' }
export const ERROR_503 = { error: 'Service Unavailable' }

// Success acknowledgements are not errors, so they keep the `{ status }` shape.
export const DEFAULT_200 = { status: 'OK' }
export const DEFAULT_202 = { status: 'Accepted' }

export const HTTP_STATUS = {
  OK: 200,
  ACCEPTED: 202,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  GONE: 410,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  SERVICE_UNAVAILABLE: 503
} as const

export const codeMap = {
  [HTTP_STATUS.OK]: DEFAULT_200,
  [HTTP_STATUS.ACCEPTED]: DEFAULT_202,

  [HTTP_STATUS.BAD_REQUEST]: ERROR_400,
  [HTTP_STATUS.UNAUTHORIZED]: ERROR_401,
  [HTTP_STATUS.FORBIDDEN]: ERROR_403,
  [HTTP_STATUS.NOT_FOUND]: ERROR_404,
  [HTTP_STATUS.CONFLICT]: ERROR_409,
  [HTTP_STATUS.GONE]: ERROR_410,
  [HTTP_STATUS.PAYLOAD_TOO_LARGE]: ERROR_413,
  [HTTP_STATUS.UNPROCESSABLE_ENTITY]: ERROR_422,
  [HTTP_STATUS.TOO_MANY_REQUESTS]: ERROR_429,

  [HTTP_STATUS.INTERNAL_SERVER_ERROR]: ERROR_500,
  [HTTP_STATUS.NOT_IMPLEMENTED]: ERROR_501,
  [HTTP_STATUS.SERVICE_UNAVAILABLE]: ERROR_503
}

export type StatusCode = keyof typeof codeMap

// HTTP reason phrases for the response `statusText`, kept independent of the
// JSON body: error bodies now carry the human-readable message under `error`
// (not `status`), so `statusText` reads from here instead of the body object.
export const REASON_PHRASE: Record<StatusCode, string> = {
  [HTTP_STATUS.OK]: 'OK',
  [HTTP_STATUS.ACCEPTED]: 'Accepted',
  [HTTP_STATUS.BAD_REQUEST]: 'Bad Request',
  [HTTP_STATUS.UNAUTHORIZED]: 'Unauthorized',
  [HTTP_STATUS.FORBIDDEN]: 'Forbidden',
  [HTTP_STATUS.NOT_FOUND]: 'Not Found',
  [HTTP_STATUS.CONFLICT]: 'Conflict',
  [HTTP_STATUS.GONE]: 'Gone',
  [HTTP_STATUS.PAYLOAD_TOO_LARGE]: 'Payload Too Large',
  [HTTP_STATUS.UNPROCESSABLE_ENTITY]: 'Unprocessable entity',
  [HTTP_STATUS.TOO_MANY_REQUESTS]: 'Too Many Requests',
  [HTTP_STATUS.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
  [HTTP_STATUS.NOT_IMPLEMENTED]: 'Not Implemented',
  [HTTP_STATUS.SERVICE_UNAVAILABLE]: 'Service Unavailable'
}

export const UNFOLLOW_NETWORK_ERROR_CODES = [
  'ENOTFOUND',
  'DEPTH_ZERO_SELF_SIGNED_CERT'
]

export const apiErrorResponse = (code: StatusCode) => {
  const span = trace.getActiveSpan()
  if (span) {
    if (code >= 400) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message:
          REASON_PHRASE[code] ||
          REASON_PHRASE[HTTP_STATUS.INTERNAL_SERVER_ERROR]
      })
    } else {
      span.setStatus({
        code: SpanStatusCode.OK
      })
    }
  }

  if (!codeMap[code]) {
    return Response.json(ERROR_500, {
      status: code,
      statusText: REASON_PHRASE[HTTP_STATUS.INTERNAL_SERVER_ERROR]
    })
  }

  return Response.json(codeMap[code], {
    status: code,
    statusText: REASON_PHRASE[code]
  })
}

export const statusText = (code: StatusCode) => REASON_PHRASE[code]
export const defaultStatusOption = (code: StatusCode) => ({
  status: code,
  statusText: statusText(code)
})

export const defaultOptions =
  (methods: HttpMethod[]) => async (req: NextRequest) => {
    return new Response(null, {
      ...defaultStatusOption(200),
      headers: new Headers(Object.entries(getCORSHeaders(methods, req.headers)))
    })
  }

/**
 * CORS-aware error shorthand: emits the standard error body for `code` (from
 * `codeMap`) through `apiResponse`, so CORS headers are included. Use on
 * CORS-enabled routes instead of repeating
 * `apiResponse({ req, allowedMethods, data: ERROR_4xx, responseStatusCode })`.
 */
export const apiCorsError = (
  req: NextRequest,
  allowedMethods: HttpMethod[],
  code: StatusCode
) =>
  apiResponse({
    req,
    allowedMethods,
    data: codeMap[code] ?? ERROR_500,
    responseStatusCode: code
  })

type APIResponseParams = {
  req: NextRequest
  allowedMethods: HttpMethod[]
  data: unknown
  responseStatusCode?: StatusCode
  additionalHeaders?: [string, string][]
}

export const apiResponse = ({
  req,
  allowedMethods,
  data,
  responseStatusCode = 200,
  additionalHeaders = []
}: APIResponseParams) => {
  const span = trace.getActiveSpan()
  if (span) {
    if (responseStatusCode >= 400) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: statusText(responseStatusCode)
      })
    } else {
      span.setStatus({
        code: SpanStatusCode.OK
      })
    }
  }

  const headers = new Headers([
    ['Server', SERVICE_NAME],
    ...Object.entries(getCORSHeaders(allowedMethods, req.headers)),
    ...additionalHeaders
  ])
  const responseOptions = {
    ...defaultStatusOption(responseStatusCode),
    headers
  }

  if (headers.has('content-type')) {
    return new Response(JSON.stringify(data) ?? 'null', responseOptions)
  }

  return Response.json(data, responseOptions)
}
