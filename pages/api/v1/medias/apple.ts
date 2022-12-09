import { NextApiRequest, NextApiResponse } from 'next'

import { getConfig } from '../../../../lib/config'
import { fetchAssetsUrl } from '../../../../lib/medias/apple/webstream'

export interface AssetsRequest {
  token: string
  photoGuids: string[]
}

const headers = (request: NextApiRequest) => {
  if (process.env.NODE_ENV !== 'production') {
    return {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json',
      'Cache-Control': 's-maxage=1, stale-while-revalidate=30'
    }
  }

  const defaultHeaders = {
    'Access-Control-Allow-Origin': `https://${getConfig().host}`,
    'Content-Type': 'application/json',
    'Cache-Control': 's-maxage=3600, stale-while-revalidate=3600'
  }
  if (!request.url) {
    return defaultHeaders
  }

  const requestHost = new URL(request.url).host
  const allowMediaDomains = getConfig().allowMediaDomains || []
  if (!allowMediaDomains.includes(requestHost)) {
    return defaultHeaders
  }

  return {
    ...defaultHeaders,
    'Access-Control-Allow-Origin': `https://${requestHost}`
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handle = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res
      .writeHead(400, 'Bad Request', headers(req))
      .json({ error: 'Invalid' })
  }
  const body = (await req.body) as AssetsRequest
  const response = await fetchAssetsUrl(body.token, body.photoGuids)
  if (!response || !response.body) {
    return res
      .writeHead(404, 'Not Found', headers(req))
      .json({ error: 'Not Found' })
  }

  const assetsData = response.json()
  return res.writeHead(200, 'OK', headers(req)).json(assetsData)
}

export default handle
