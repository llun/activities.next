import { SpanStatusCode, trace } from '@opentelemetry/api'
import { NextApiResponse } from 'next'
import { NextRequest } from 'next/server'

import { SERVICE_NAME } from '../constants'
import { HttpMethod, getCORSHeaders } from './getCORSHeaders'

export const ERROR_500 = { status: 'Internal Server Error' }

export const ERROR_400 = { status: 'Bad Request' }
export const ERROR_401 = { status: 'Unauthorized' }
export const ERROR_403 = { status: 'Forbidden' }
export const ERROR_404 = { status: 'Not Found' }
export const ERROR_422 = { status: 'Unprocessable entity' }

export const DEFAULT_200 = { status: 'OK' }
export const DEFAULT_202 = { status: 'Accepted' }

export const HTTP_STATUS = {
  OK: 200,
  ACCEPTED: 202,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  UNPROCESSABLE_ENTITY: 422,
  INTERNAL_SERVER_ERROR: 500
} as const

export const codeMap = {
  [HTTP_STATUS.OK]: DEFAULT_200,
  [HTTP_STATUS.ACCEPTED]: DEFAULT_202,

  [HTTP_STATUS.BAD_REQUEST]: ERROR_400,
  [HTTP_STATUS.UNAUTHORIZED]: ERROR_401,
  [HTTP_STATUS.FORBIDDEN]: ERROR_403,
  [HTTP_STATUS.NOT_FOUND]: ERROR_404,
  [HTTP_STATUS.UNPROCESSABLE_ENTITY]: ERROR_422,

  [HTTP_STATUS.INTERNAL_SERVER_ERROR]: ERROR_500
}

export type StatusCode = keyof typeof codeMap

export const errorResponse = (
  res: NextApiResponse,
  code: keyof typeof codeMap
) => {
  const span = trace.getActiveSpan()
  if (span) {
    if (code >= 400) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: codeMap[code]?.status || ERROR_500.status
      })
    } else {
      span.setStatus({
        code: SpanStatusCode.OK
      })
    }
  }

  if (codeMap[code]) {
    res.status(code).json(codeMap[code])
    return
  }
  res.status(code).json(ERROR_500)
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
        message: codeMap[code]?.status || ERROR_500.status
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
      statusText: ERROR_500.status
    })
  }

  return Response.json(codeMap[code], {
    status: code,
    statusText: codeMap[code].status
  })
}

export const statusText = (code: StatusCode) => codeMap[code].status
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

  return Response.json(data, {
    ...defaultStatusOption(responseStatusCode),
    headers: new Headers([
      ['Server', SERVICE_NAME],
      ...Object.entries(getCORSHeaders(allowedMethods, req.headers)),
      ...additionalHeaders
    ])
  })
}
