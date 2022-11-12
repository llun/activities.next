import type { NextApiRequest, NextApiResponse } from 'next'
import { getConfig } from '../../../lib/config'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const config = await getConfig()
  res.setHeader('Content-Type', 'application/xrd+xml; charset=utf-8')
  res.status(200).send(
    `
<?xml version="1.0" encoding="UTF-8"?>
<XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0">
  <Link rel="lrdd" template="https://${config.host}/.well-known/webfinger?resource={uri}"/>
</XRD>`.trim()
  )
}
