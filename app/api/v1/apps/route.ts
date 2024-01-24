import { NextRequest } from 'next/server'

import { apiErrorResponse } from '@/lib/errors'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getStorage } from '@/lib/storage'

import { createApplication } from './createApplication'
import { PostRequest } from './types'

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

  const host = headerHost(req.headers)
  return Response.json(rest, {
    status: 200,
    statusText: 'OK',
    headers: {
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Origin':
        req.headers.get('origin') ?? `https://${host}`
    }
  })
}
