import { NextRequest } from 'next/server'

import { apiErrorResponse } from '@/lib/errors'
import { fetchAssetsUrl } from '@/lib/services/apple/webstream'
import { AppRouterParams } from '@/lib/services/guards/types'

interface Params {
  token: string
  guidWithChecksum: string
}

export const GET = async (
  req: NextRequest,
  params: AppRouterParams<Params>
) => {
  const { token, guidWithChecksum } = params.params
  const [guid, checksum] = (guidWithChecksum as string).split('@')
  if (!guid || !checksum) return apiErrorResponse(404)

  const assets = await fetchAssetsUrl(token as string, [guid])
  if (!assets) return apiErrorResponse(404)

  const item = assets.items[checksum]
  if (!item) return apiErrorResponse(404)

  const scheme = assets.locations[item.url_location].scheme
  const host = assets.locations[item.url_location].hosts[0]
  const prefix = `${scheme}://${host}`
  const url = `${prefix}${item.url_path}`

  return Response.redirect(url)
}
