import { NextRequest } from 'next/server'
import { z } from 'zod'

import { ERROR_404, defaultStatusOption } from '@/lib/errors'
import { fetchAssetsUrl } from '@/lib/services/apple/webstream'
import { AppRouterParams } from '@/lib/services/guards/types'

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
    if (!assets) {
      return Response.json(ERROR_404, defaultStatusOption(404))
    }

    const headers = new Headers([
      ['Access-Control-Allow-Origin', allowOrigin(req)],
      ['Vary', 'Origin']
    ])

    return Response.json({ assets }, { ...defaultStatusOption(200), headers })
  } catch {
    return Response.json(ERROR_404, defaultStatusOption(404))
  }
}
