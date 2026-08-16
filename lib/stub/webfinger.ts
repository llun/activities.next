interface Params {
  account: string
  userUrl?: string
  aliases?: string[]
  links?: {
    rel: string
    type?: string
    href?: string
    template?: string
  }[]
  includeProfileLink?: boolean
  includeSelfLink?: boolean
  includeSubscribeLink?: boolean
}
export const MockWebfinger = ({
  account,
  userUrl,
  aliases,
  links,
  includeProfileLink = true,
  includeSelfLink = true,
  includeSubscribeLink = false
}: Params) => {
  const [user, domain] = account.split('@')
  const profilePage = `https://${domain}/@${user}`
  const resolvedLinks = links ?? [
    ...(includeProfileLink
      ? [
          {
            rel: 'http://webfinger.net/rel/profile-page',
            type: 'text/html',
            href: profilePage
          }
        ]
      : []),
    ...(includeSelfLink
      ? [
          {
            rel: 'self',
            type: 'application/activity+json',
            href: userUrl ?? `https://${domain}/users/${user}`
          }
        ]
      : []),
    ...(includeSubscribeLink
      ? [
          {
            rel: 'http://ostatus.org/schema/1.0/subscribe',
            template: `https://${domain}/authorize_interaction?uri={uri}`
          }
        ]
      : [])
  ]
  return {
    subject: `acct:${account}`,
    aliases: aliases ?? [profilePage],
    links: resolvedLinks
  }
}
