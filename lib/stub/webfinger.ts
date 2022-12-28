interface Params {
  account: string
  userUrl?: string
  aliases?: string[]
}
export const MockWebfinger = ({ account, userUrl, aliases }: Params) => {
  const [user, domain] = account.split('@')
  const profilePage = `https://${domain}/@${user}`
  return {
    subject: `acct:${account}`,
    aliases: aliases ?? [profilePage],
    links: [
      {
        rel: 'http://webfinger.net/rel/profile-page',
        type: 'text/html',
        href: profilePage
      },
      {
        rel: 'self',
        type: 'application/activity+json',
        href: userUrl ?? `https://${domain}/users/${user}`
      }
    ]
  }
}
