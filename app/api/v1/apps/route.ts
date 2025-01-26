import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'

import { createApplication } from './createApplication'
import { PostRequest } from './types'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = async (req: NextRequest) => {
  const database = getDatabase()
  if (!database) {
    return apiErrorResponse(500)
  }

  const body = await req.formData()
  const json = Object.fromEntries(body.entries())
  const postRequest = PostRequest.parse(json)
  const response = await createApplication(database, postRequest)

  const { type, ...rest } = response
  if (type === 'error') {
    return apiErrorResponse(422)
  }

  return apiResponse(req, CORS_HEADERS, rest)
}
