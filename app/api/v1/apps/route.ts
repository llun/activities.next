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

/**
 * Parse request data based on content type
 * @param req NextRequest object
 * @returns Parsed request data as unknown (to be validated by Zod)
 */
async function parseRequestData(
  req: NextRequest
): Promise<Record<string, unknown>> {
  const contentType = req.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    return req.json()
  }

  const formData = await req.formData()
  return Object.fromEntries(formData.entries())
}

export const POST = async (req: NextRequest) => {
  const database = getDatabase()
  if (!database) {
    return apiErrorResponse(500)
  }

  const json = await parseRequestData(req)
  const postRequest = PostRequest.parse(json)
  const response = await createApplication(database, postRequest)

  const { type, ...rest } = response
  if (type === 'error') {
    return apiErrorResponse(422)
  }

  return apiResponse({ req, allowedMethods: CORS_HEADERS, data: rest })
}
