// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from 'next'

import { Error, WebFinger } from '../../../lib/activities/types'
import { ERROR_404 } from '../../../lib/errors'
import { getStorage } from '../../../lib/storage'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WebFinger | Error>
) {
  const { resource } = req.query
  if (!resource) {
    return res.status(404).json(ERROR_404)
  }

  const firstResource = Array.isArray(resource) ? resource[0] : resource
  const account = firstResource.startsWith('acct:')
    ? firstResource.slice(5)
    : firstResource

  const [username, domain] = account.split('@')
  const storage = await getStorage()
  const actor = await storage?.getActorFromUsername({ username, domain })

  // This is not local actors
  if (!actor?.privateKey) res.status(404).json(ERROR_404)

  res.status(200).json({
    subject: `acct:${account}@${domain}`,
    aliases: [`https://${domain}/@${account}`, `https://${domain}/users/llun`],
    links: [
      {
        rel: 'http://webfinger.net/rel/profile-page',
        type: 'text/html',
        href: `https://${domain}/@${account}`
      },
      {
        rel: 'self',
        type: 'application/activity+json',
        href: `https://${domain}/users/${account}`
      }
    ]
  })
}
