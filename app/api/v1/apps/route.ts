import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { getRequestBody } from '@/lib/utils/getRequestBody'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

import { createApplication } from './createApplication'
import { PostRequest } from './types'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute('createApp', async (req: NextRequest) => {
  const database = getDatabase()
  if (!database) {
    return apiErrorResponse(500)
  }

  const json = await getRequestBody(req)
  const postRequest = PostRequest.parse(json)
  const response = await createApplication(database, postRequest)

  const { type, ...rest } = response
  if (type === 'error') {
    return apiErrorResponse(422)
  }

  return apiResponse({ req, allowedMethods: CORS_HEADERS, data: rest })
})
