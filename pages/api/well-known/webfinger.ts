// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from 'next'

import { WebFinger } from '../../../lib/activities/types'
import { getConfig } from '../../../lib/config'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WebFinger>
) {
  const config = getConfig()
  const { resource } = req.query
  const account = resource?.slice('acct:'.length, resource.indexOf('@'))

  res.status(200).json({
    subject: `acct:${account}@${config.host}`,
    aliases: [
      `https://${config.host}/@${account}`,
      `https://${config.host}/users/llun`
    ],
    links: [
      {
        rel: 'http://webfinger.net/rel/profile-page',
        type: 'text/html',
        href: `https://${config.host}/@${account}`
      },
      {
        rel: 'self',
        type: 'application/activity+json',
        href: `https://${config.host}/users/${account}`
      }
    ]
  })
}
