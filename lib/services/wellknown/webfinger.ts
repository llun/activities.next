import { getBaseURL } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { parseAccountUrlHandle } from '@/lib/utils/accountHandle'

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
  fallbackDomain?: string
}

const getAccountFromResource = (
  resource: string,
  fallbackDomain?: string
): { username: string; domain: string; normalizedDomain: string } | null => {
  const trimmedResource = resource.trim()
  if (!trimmedResource) return null

  // Support ActivityPub actor URLs (/users/:username) and profile URLs (/@:username)
  if (
    trimmedResource.startsWith('https://') ||
    trimmedResource.startsWith('http://')
  ) {
    const urlHandle = parseAccountUrlHandle(trimmedResource)
    if (urlHandle) {
      return {
        username: urlHandle.username,
        domain: urlHandle.domain,
        normalizedDomain: urlHandle.domain.toLowerCase()
      }
    }
  }

  const account = trimmedResource.toLowerCase().startsWith('acct:')
    ? trimmedResource.slice('acct:'.length)
    : trimmedResource
  const normalizedAccount = account.replace(/^@/, '')
  const parts = normalizedAccount.split('@')

  if (parts.length === 2) {
    const [username, domain] = parts.map((part) => part.trim())
    if (!username || !domain) return null

    return {
      username,
      domain,
      normalizedDomain: domain.toLowerCase()
    }
  }

  if (parts.length === 1 && fallbackDomain) {
    const username = parts[0].trim()
    const domain = fallbackDomain.trim()
    if (!username || !domain) return null

    return {
      username,
      domain,
      normalizedDomain: domain.toLowerCase()
    }
  }

  return null
}

export const getWebFingerResponse = async ({
  database,
  resource,
  fallbackDomain
}: GetWebFingerParams): Promise<WebFingerResponse | null> => {
  const trimmedResource = resource.trim()
  const account = getAccountFromResource(trimmedResource, fallbackDomain)

  let actor = account
    ? ((await database.getActorFromUsername({
        username: account.username,
        domain: account.domain
      })) ??
      (account.domain === account.normalizedDomain
        ? null
        : await database.getActorFromUsername({
            username: account.username,
            domain: account.normalizedDomain
          })))
    : null

  if (
    !actor &&
    'getActorFromId' in database &&
    typeof database.getActorFromId === 'function' &&
    (trimmedResource.startsWith('https://') ||
      trimmedResource.startsWith('http://'))
  ) {
    actor = await database.getActorFromId({ id: trimmedResource })
  }

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
