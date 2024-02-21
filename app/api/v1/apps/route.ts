import { NextRequest } from 'next/server'

import { apiErrorResponse, defaultStatusOption } from '@/lib/errors'
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
    ...defaultStatusOption(200),
    headers: new Headers(getCORSHeaders('POST', req.headers))
  })
}
