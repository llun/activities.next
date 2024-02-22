import { NextRequest } from 'next/server'

import {
  apiErrorResponse,
  defaultOptions,
  defaultStatusOption
} from '@/lib/response'
import { getStorage } from '@/lib/storage'
import { HttpMethod, getCORSHeaders } from '@/lib/utils/getCORSHeaders'

import { createApplication } from './createApplication'
import { PostRequest } from './types'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = async (req: NextRequest) => {
  const [storage, body] = await Promise.all([getStorage(), req.formData()])
  if (!storage) {
    return apiErrorResponse(500)
  }

  const json = Object.fromEntries(body.entries())
  const postRequest = PostRequest.parse(json)
  const response = await createApplication(storage, postRequest)

  const { type, ...rest } = response
  if (type === 'error') {
    return apiErrorResponse(422)
  }

  return Response.json(rest, {
    ...defaultStatusOption(200),
    headers: new Headers(getCORSHeaders(CORS_HEADERS, req.headers))
  })
}
