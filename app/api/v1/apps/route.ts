import crypto from 'crypto'
import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { getRequestBody } from '@/lib/utils/getRequestBody'
import {
  ERROR_422,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

import { createApplication } from './createApplication'
import { PostRequest } from './types'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const getAppRegistrationKey = (req: NextRequest): string | undefined => {
  const cloudflareIp = req.headers.get('cf-connecting-ip')?.trim()
  const realIp = req.headers.get('x-real-ip')?.trim()
  const forwardedFor = req.headers
    .get('x-forwarded-for')
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .at(-1)
  const ipAddress = cloudflareIp || realIp || forwardedFor

  if (!ipAddress) return undefined

  return crypto.createHash('sha256').update(ipAddress).digest('base64url')
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

  const { type, ...rest } = response
  if (type === 'error') {
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: ERROR_422,
      responseStatusCode: 422
    })
  }

  return apiResponse({ req, allowedMethods: CORS_HEADERS, data: rest })
})
