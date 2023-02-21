// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from 'next'

import { Error, WebFinger } from '../../../lib/activities/types'
import { ERROR_404 } from '../../../lib/responses'
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
  if (!domain) {
    return res.status(404).json(ERROR_404)
  }

  const storage = await getStorage()
  const actor = await storage?.getActorFromUsername({ username, domain })

  // This is not local actors
  if (!actor?.privateKey) {
    return res.status(404).json(ERROR_404)
  }

  res.status(200).json({
    subject: `acct:${username}@${domain}`,
    aliases: [
      `https://${domain}/@${username}`,
      `https://${domain}/users/${username}`
    ],
    links: [
      {
        rel: 'http://webfinger.net/rel/profile-page',
        type: 'text/html',
        href: `https://${domain}/@${username}`
      },
      {
        rel: 'self',
        type: 'application/activity+json',
        href: `https://${domain}/users/${username}`
      },
      {
        rel: 'self',
        type: 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
        href: `https://${domain}/users/${username}`
      }
    ]
  })
}
