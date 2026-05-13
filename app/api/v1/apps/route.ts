import crypto from 'crypto'
import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { getRequestBody } from '@/lib/utils/getRequestBody'
import {
  ERROR_422,
  ERROR_429,
  ERROR_500,
  HTTP_STATUS,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

import { createApplication } from './createApplication'
import { PostRequest } from './types'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const getAppRegistrationKey = (req: NextRequest): string | undefined => {
  const connectionIp = (req as NextRequest & { ip?: string }).ip
  if (!connectionIp) return undefined

  const hash = crypto
    .createHash('sha256')
    .update(connectionIp)
    .digest('base64url')
  return `ip:${hash}`
}

export const POST = traceApiRoute('createApp', async (req: NextRequest) => {
  const database = getDatabase()
  if (!database) {
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: ERROR_500,
      responseStatusCode: 500
    })
  }

  const json = await getRequestBody(req)
  const parseResult = PostRequest.safeParse(json)
  if (!parseResult.success) {
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: ERROR_422,
      responseStatusCode: 422
    })
  }
  const response = await createApplication(parseResult.data, {
    registrationKey: getAppRegistrationKey(req)
  })

  if (response.type === 'error') {
    if (response.error === 'Too many application registrations') {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_429,
        responseStatusCode: HTTP_STATUS.TOO_MANY_REQUESTS
      })
    }

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: ERROR_422,
      responseStatusCode: 422
    })
  }

  const { type: _type, ...data } = response
  return apiResponse({ req, allowedMethods: CORS_HEADERS, data })
})
