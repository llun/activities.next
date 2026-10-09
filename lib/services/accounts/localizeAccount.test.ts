import { localizeAccount, localizeAccounts } from './localizeAccount'

const account = (
  overrides: Partial<{ username: string; acct: string; url: string }> = {}
) => ({
  username: 'null',
  acct: 'null@llun.dev',
  url: 'https://llun.dev/users/null',
  ...overrides
})

describe('localizeAccount', () => {
  it.each([
    [
      'bare when the access domain matches the actor domain',
      'llun.dev',
      {},
      'null'
    ],
    [
      'qualified when the actor is on another domain',
      'llun.social',
      {},
      'null@llun.dev'
    ],
    [
      'qualified from a bare stored acct when the access domain differs',
      'llun.social',
      { acct: 'null' },
      'null@llun.dev'
    ],
    ['bare when the domains match case-insensitively', 'LLUN.DEV', {}, 'null'],
    [
      'qualified when the domains differ case-insensitively',
      'LLUN.SOCIAL',
      {},
      'null@llun.dev'
    ],
    [
      'bare when the access domain carries a scheme',
      'https://llun.dev',
      {},
      'null'
    ]
  ])('renders acct %s', (_label, accessDomain, overrides, expected) => {
    const input = account(overrides)
    const result = localizeAccount(input, accessDomain)
    expect(result.acct).toBe(expected)
    // Only acct changes, never the url.
    expect(result.url).toBe(input.url)
  })

  // A remote actor confirmed through its host's WebFinger redirect is stored under
  // that domain, not the host of its id, and is shown that way.
  it('keeps the stored handle domain of a qualified acct', () => {
    const input = account({
      username: 'alice',
      acct: 'alice@remote.test',
      url: 'https://ap.remote.test/users/1234'
    })

    expect(localizeAccount(input, 'llun.dev').acct).toBe('alice@remote.test')
    expect(localizeAccount(input, 'ap.remote.test').acct).toBe(
      'alice@remote.test'
    )
  })

  it('returns the account unchanged when no access domain is given', () => {
    const input = account()
    const result = localizeAccount(input, undefined)
    expect(result).toBe(input)
    expect(result.acct).toBe('null@llun.dev')
  })

  it('returns the account unchanged when url is not a parseable URL', () => {
    const input = account({ url: 'not-a-url' })
    const result = localizeAccount(input, 'llun.dev')
    expect(result).toBe(input)
  })

  it('localizes each account in a list', () => {
    const results = localizeAccounts(
      [
        account({
          url: 'https://llun.dev/users/a',
          username: 'a',
          acct: 'a@llun.dev'
        }),
        account({
          url: 'https://llun.social/users/b',
          username: 'b',
          acct: 'b'
        })
      ],
      'llun.dev'
    )
    expect(results.map((account) => account.acct)).toEqual([
      'a',
      'b@llun.social'
    ])
  })
})
