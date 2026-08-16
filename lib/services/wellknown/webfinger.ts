import { getBaseURL } from '@/lib/config'
import { Database } from '@/lib/database/types'

// Standard OStatus rel other servers look for to discover where to send a
// visitor who typed their handle into a remote "follow from your server"
// dialog. Mastodon guesses `/authorize_interaction` when it is absent, but
// other implementations do not, so advertise it.
export const REMOTE_FOLLOW_SUBSCRIBE_REL =
  'http://ostatus.org/schema/1.0/subscribe'

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
      },
      // The template is instance-level rather than per-account, so it is built
      // from getBaseURL() (which honours ACTIVITIES_INSECURE_AUTH) instead of
      // this file's older hardcoded `https://${actor.domain}` profile URLs: the
      // consumer is a browser that has to end up signed in on THIS instance,
      // and sessions are anchored to the configured host. Concatenate rather
      // than building with URL/URLSearchParams — those percent-encode `{uri}`
      // to `%7Buri%7D` and break consumers doing a literal `.replace('{uri}')`.
      {
        rel: REMOTE_FOLLOW_SUBSCRIBE_REL,
        template: `${getBaseURL()}/authorize_interaction?uri={uri}`
      }
    ]
  }
}
