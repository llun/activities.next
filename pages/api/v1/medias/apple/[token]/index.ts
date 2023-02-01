import { NextApiRequest, NextApiResponse } from 'next'

import { getConfig } from '../../../../../../lib/config'
import { headerHost } from '../../../../../../lib/guard'
import { fetchStream } from '../../../../../../lib/medias/apple/webstream'

export const allowOrigin = (request: NextApiRequest) => {
  if (process.env.NODE_ENV !== 'production') return '*'

  const defaultAllowOrigin = `https://${getConfig().host}`
  const requestHost = headerHost(request.headers)
  if (!requestHost || Array.isArray(requestHost)) return defaultAllowOrigin

  const allowMediaDomains = getConfig().allowMediaDomains || []
  if (!allowMediaDomains.includes(requestHost)) {
    return defaultAllowOrigin
  }

  return `https://${requestHost}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handle = async (req: NextApiRequest, res: NextApiResponse) => {
  res.setHeader('Access-Control-Allow-Origin', allowOrigin(req))
  res.setHeader('Vary', 'Origin')

  if (req.method !== 'GET') {
    return res.status(400).json({ error: 'Invalid' })
  }

  const { token } = req.query
  const stream = await fetchStream(token as string)
  if (!stream) {
    return res.status(404).json({ error: 'Not Found' })
  }

  return res.status(200).json({ stream })
}

export default handle
