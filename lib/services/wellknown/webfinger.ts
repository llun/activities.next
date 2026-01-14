import { Database } from '@/lib/database/types'

export interface WebFingerLink {
  rel: string
  type?: string
  href?: string
  template?: string
}

export interface WebFingerResponse {
  subject: string
  aliases: string[]
  links: WebFingerLink[]
}

interface GetWebFingerParams {
  database: Database
  resource: string
}

export const getWebFingerResponse = async ({
  database,
  resource
}: GetWebFingerParams): Promise<WebFingerResponse | null> => {
  const account = resource.startsWith('acct:') ? resource.slice(5) : resource

  const [username, domain] = account.split('@')
  if (!domain) return null

  const actor = await database.getActorFromUsername({ username, domain })

  // This is not local actors
  if (!actor?.privateKey) return null

  return {
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
  }
}
