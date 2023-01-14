// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from 'next'

import { Error, WebFinger } from '../../../lib/activities/types'
import { getConfig } from '../../../lib/config'
import { ERROR_404 } from '../../../lib/errors'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WebFinger | Error>
) {
  const config = getConfig()
  const { resource } = req.query
  if (!resource) {
    return res.status(404).json(ERROR_404)
  }

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
