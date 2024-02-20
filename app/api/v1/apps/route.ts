import { NextRequest } from 'next/server'

import { apiErrorResponse } from '@/lib/errors'
import { getStorage } from '@/lib/storage'

import { createApplication } from './createApplication'
import { PostRequest } from './types'
import { getCORSHeaders } from '@/lib/utils/getCORSHeaders'

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
    status: 200,
    statusText: 'OK',
    headers: getCORSHeaders('POST', req.headers)
  })
}
