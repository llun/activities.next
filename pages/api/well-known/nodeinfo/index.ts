import type { NextApiRequest, NextApiResponse } from 'next'

import { Link } from '../../../../lib/activities/types'
import { getConfig } from '../../../../lib/config'

type Data = {
  links: Link[]
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  const config = getConfig()
  res.status(200).json({
    links: [
      {
        rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
        href: `https://${config.host}/.well-known/nodeinfo/2.0`
      }
    ]
  })
}
