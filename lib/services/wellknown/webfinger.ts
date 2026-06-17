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

const getAccountFromResource = (resource: string) => {
  const trimmedResource = resource.trim()
  const account = trimmedResource.toLowerCase().startsWith('acct:')
    ? trimmedResource.slice('acct:'.length)
    : trimmedResource
  const parts = account.split('@')

  if (parts.length !== 2) return null

  const [username, domain] = parts.map((part) => part.trim())
  if (!username || !domain) return null

  return {
    username,
    domain,
    normalizedDomain: domain.toLowerCase()
  }
}

export const getWebFingerResponse = async ({
  database,
  resource
}: GetWebFingerParams): Promise<WebFingerResponse | null> => {
  const account = getAccountFromResource(resource)
  if (!account) return null

  const actor =
    (await database.getActorFromUsername({
      username: account.username,
      domain: account.domain
    })) ??
    (account.domain === account.normalizedDomain
      ? null
      : await database.getActorFromUsername({
          username: account.username,
          domain: account.normalizedDomain
        }))

  // This is not local actors
  if (!actor?.privateKey) return null

  const profilePageUrl =
    actor.type === 'Service'
      ? actor.id
      : `https://${actor.domain}/@${actor.username}`
  const profilePageLink =
    actor.type === 'Service'
      ? []
      : [
          {
            rel: 'http://webfinger.net/rel/profile-page',
            type: 'text/html',
            href: profilePageUrl
          }
        ]

  return {
    subject: `acct:${actor.username}@${actor.domain}`,
    aliases: actor.type === 'Service' ? [actor.id] : [profilePageUrl, actor.id],
    links: [
      ...profilePageLink,
      {
        rel: 'self',
        type: 'application/activity+json',
        href: actor.id
      },
      {
        rel: 'self',
        type: 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
        href: actor.id
      }
    ]
  }
}
