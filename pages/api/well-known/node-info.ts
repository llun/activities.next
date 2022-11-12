import type { NextApiRequest, NextApiResponse } from 'next'
import { getConfig } from '../../../lib/config'
import { Link } from './webfinger'

type Data = {
  links: Link[]
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  const config = await getConfig()
  res.status(200).json({
    links: [
      {
        rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
        href: `https://${config.host}/nodeinfo`
      }
    ]
  })
}
