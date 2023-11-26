import { NextRequest } from 'next/server'

import { ERROR_404 } from '../../../../../../../lib/errors'
import { AppRouterParams } from '../../../../../../../lib/guard'
import { fetchAssetsUrl } from '../../../../../../../lib/medias/apple/webstream'

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
  if (!guid || !checksum) {
    return Response.json(ERROR_404, { status: 404 })
  }

  const assets = await fetchAssetsUrl(token as string, [guid])
  if (!assets) {
    return Response.json(ERROR_404, { status: 404 })
  }

  const item = assets.items[checksum]
  if (!item) {
    return Response.json(ERROR_404, { status: 404 })
  }

  const scheme = assets.locations[item.url_location].scheme
  const host = assets.locations[item.url_location].hosts[0]
  const prefix = `${scheme}://${host}`
  const url = `${prefix}${item.url_path}`

  return Response.redirect(url)
}
