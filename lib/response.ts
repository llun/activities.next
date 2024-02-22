import { NextApiResponse } from 'next'
import { NextRequest } from 'next/server'

import { HttpMethod, getCORSHeaders } from './utils/getCORSHeaders'

export const ERROR_500 = { status: 'Internal Server Error' }

export const ERROR_400 = { status: 'Bad Request' }
export const ERROR_401 = { status: 'Unauthorized' }
export const ERROR_403 = { status: 'Forbidden' }
export const ERROR_404 = { status: 'Not Found' }
export const ERROR_422 = { status: 'Unprocessable entity' }

export const DEFAULT_200 = { status: 'OK' }
export const DEFAULT_202 = { status: 'Accepted' }

export const codeMap = {
  200: DEFAULT_200,
  202: DEFAULT_202,

  400: ERROR_400,
  401: ERROR_401,
  403: ERROR_403,
  404: ERROR_404,
  422: ERROR_422,

  500: ERROR_500
}

export type StatusCode = keyof typeof codeMap

export const errorResponse = (
  res: NextApiResponse,
  code: keyof typeof codeMap
) => {
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
