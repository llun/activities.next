import { NextRequest } from 'next/server'
import { z } from 'zod'

import { fetchAssetsUrl } from '@/lib/services/apple/webstream'
import { AppRouterParams } from '@/lib/services/guards/types'
import { apiErrorResponse, defaultStatusOption } from '@/lib/utils/response'

import { allowOrigin } from '../utils'

const AssetsRequest = z.object({
  photoGuids: z.string().array()
})

type AssetsRequest = z.infer<typeof AssetsRequest>

interface Params {
  token: string
}

export const POST = async (
  req: NextRequest,
  params: AppRouterParams<Params>
) => {
  const { token } = params.params
  try {
    const assetsRequest = AssetsRequest.parse(await req.json())
    const assets = await fetchAssetsUrl(token, assetsRequest.photoGuids)
    if (!assets) return apiErrorResponse(404)

    const headers = new Headers([
      ['Access-Control-Allow-Origin', allowOrigin(req)],
      ['Vary', 'Origin']
    ])

    return Response.json({ assets }, { ...defaultStatusOption(200), headers })
  } catch {
    return apiErrorResponse(404)
  }
}
