import { NextRequest } from 'next/server'

import { ERROR_404 } from '@/lib/errors'

import { PostRequest } from './types'

export const POST = async (req: NextRequest) => {
  const body = await req.formData()
  const json = Object.fromEntries(body.entries())
  const postRequest = PostRequest.parse(json)
  console.log(postRequest)
  return Response.json(ERROR_404, { status: 404, statusText: 'Not Found' })
}
