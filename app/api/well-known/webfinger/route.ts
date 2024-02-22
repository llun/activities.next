import { type NextRequest } from 'next/server'

import { apiErrorResponse } from '@/lib/response'
import { getStorage } from '@/lib/storage'

export const GET = async (req: NextRequest) => {
  const url = new URL(req.url)
  const resource = url.searchParams.get('resource')
  if (!resource) return apiErrorResponse(404)

  const firstResource = Array.isArray(resource) ? resource[0] : resource
  const account = firstResource.startsWith('acct:')
    ? firstResource.slice(5)
    : firstResource

  const [username, domain] = account.split('@')
  if (!domain) return apiErrorResponse(404)

  const storage = await getStorage()
  const actor = await storage?.getActorFromUsername({ username, domain })

  // This is not local actors
  if (!actor?.privateKey) return apiErrorResponse(404)

  return Response.json({
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
