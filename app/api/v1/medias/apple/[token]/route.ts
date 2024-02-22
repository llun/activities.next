import { NextRequest } from 'next/server'

import { apiErrorResponse, defaultStatusOption } from '@/lib/errors'
import { fetchStream } from '@/lib/services/apple/webstream'
import { AppRouterParams } from '@/lib/services/guards/types'

import { allowOrigin } from './utils'

interface Params {
  token: string
}

export const GET = async (
  req: NextRequest,
  params: AppRouterParams<Params>
) => {
  const token = params.params.token
  const stream = await fetchStream(token)
  if (!stream) return apiErrorResponse(404)

  const headers = new Headers([
    ['Access-Control-Allow-Origin', allowOrigin(req)],
    ['Vary', 'Origin']
  ])
  return Response.json({ stream }, { ...defaultStatusOption(200), headers })
}
