interface Params {
  account: string
  aliases?: string[]
}
export const MockWebfinger = ({ account, aliases }: Params) => {
  const [user, domain] = account.split('@')
  const profilePage = `https://${domain}/@${user}`
  const userUrl = `https://${domain}/users/${user}`
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
        href: userUrl
      }
    ]
  }
}
