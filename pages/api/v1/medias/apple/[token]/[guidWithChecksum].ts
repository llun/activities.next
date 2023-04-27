import { NextApiRequest, NextApiResponse } from 'next'

import { allowOrigin } from '.'
import {
  Assets,
  fetchAssetsUrl
} from '../../../../../../lib/medias/apple/webstream'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handle = async (req: NextApiRequest, res: NextApiResponse) => {
  res.setHeader('Access-Control-Allow-Origin', allowOrigin(req))
  res.setHeader('Vary', 'Origin')

  if (req.method !== 'GET') {
    res.status(400).json({ error: 'Invalid' })
    return
  }

  const { token, guidWithChecksum } = req.query
  const [guid, checksum] = (guidWithChecksum as string).split('@')
  if (!guid || !checksum) {
    res.status(404).json({ error: 'Not Found' })
    return
  }

  const response = await fetchAssetsUrl(token as string, [guid])
  if (!response || !response.body) {
    res.status(404).json({ error: 'Not Found' })
    return
  }

  const assets = (await response.json()) as Assets

  const item = assets.items[checksum]
  if (!item) {
    res.status(404).json({ error: 'Not Found' })
    return
  }

  const scheme = assets.locations[item.url_location].scheme
  const host = assets.locations[item.url_location].hosts[0]
  const prefix = `${scheme}://${host}`
  const url = `${prefix}${item.url_path}`
  res.status(302).redirect(url)
}

export default handle
