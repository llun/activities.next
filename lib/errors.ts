import { NextApiResponse } from 'next'

export const ERROR_500 = { error: 'Internal Server Error' }

export const ERROR_400 = { error: 'Bad Request' }
export const ERROR_403 = { error: 'Forbidden' }
export const ERROR_404 = { error: 'Not Found' }
export const ERROR_422 = { error: 'Unprocessable entity' }

export const DEFAULT_202 = { status: 'Accepted' }

const errorCodeMap = {
  400: ERROR_400,
  403: ERROR_403,
  404: ERROR_404,
  422: ERROR_422,

  500: ERROR_500
}

export const errorResponse = (
  res: NextApiResponse,
  code: keyof typeof errorCodeMap
) => {
  if (errorCodeMap[code]) {
    res.status(code).json(errorCodeMap[code])
    return
  }
  res.status(code).json(ERROR_500)
}

export const UNFOLLOW_NETWORK_ERROR_CODES = [
  'ENOTFOUND',
  'DEPTH_ZERO_SELF_SIGNED_CERT'
]

export const apiErrorResponse = (code: keyof typeof errorCodeMap) => {
  if (!errorCodeMap[code]) {
    return Response.json(ERROR_500, {
      status: code,
      statusText: ERROR_500.error
    })
  }

  return Response.json(errorCodeMap[code], {
    status: code,
    statusText: errorCodeMap[code].error
  })
}
