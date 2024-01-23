import { NextRequest } from 'next/server'

import { ERROR_422, ERROR_500 } from '@/lib/errors'

import { PostRequest } from './types'
import { createApplication } from './createApplication'
import { getStorage } from '@/lib/storage'

export const POST = async (req: NextRequest) => {
  const [storage, body] = await Promise.all([
    getStorage(),
    req.formData()
  ])
  if (!storage) {
    return Response.json(ERROR_500, { status: 500, statusText: 'Internal Server Error' })
  }

  const json = Object.fromEntries(body.entries())
  const postRequest = PostRequest.parse(json)
  const response = await createApplication(storage, postRequest)

  const { type, ...rest } = response
  if (type === 'error') {
    return Response.json(ERROR_422, { status: 422, statusText: 'Unprocessable Content' })
  }

  return Response.json(rest, { status: 200, statusText: 'OK' })
}
