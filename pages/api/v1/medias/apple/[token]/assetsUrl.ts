import { NextApiRequest, NextApiResponse } from 'next'

import { allowOrigin } from '.'
import {
  Assets,
  fetchAssetsUrl
} from '../../../../../../lib/medias/apple/webstream'

export interface AssetsRequest {
  photoGuids: string[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handle = async (req: NextApiRequest, res: NextApiResponse) => {
  res.setHeader('Access-Control-Allow-Origin', allowOrigin(req))
  res.setHeader('Vary', 'Origin')

  if (req.method !== 'POST') {
    res.status(400).json({ error: 'Invalid' })
    return
  }
  const { token } = req.query
  const body = req.body as AssetsRequest
  const response = await fetchAssetsUrl(token as string, body.photoGuids)
  if (!response || !response.body) {
    res.status(404).json({ error: 'Not Found' })
    return
  }

  const assets = (await response.json()) as Assets
  res.status(200).json({ assets })
}

export default handle
