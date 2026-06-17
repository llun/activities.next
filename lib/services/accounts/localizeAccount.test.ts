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
  it('renders a bare acct when the actor domain matches the access domain', () => {
    const result = localizeAccount(account(), 'llun.dev')
    expect(result.acct).toBe('null')
  })

  it('renders a qualified acct when the actor is on another domain', () => {
    const result = localizeAccount(account(), 'llun.social')
    expect(result.acct).toBe('null@llun.dev')
  })

  it.each([
    ['bare matching access domain', 'LLUN.DEV', 'null'],
    ['qualified non-matching access domain', 'LLUN.SOCIAL', 'null@llun.dev']
  ])(
    'compares domains case-insensitively (%s)',
    (_label, accessDomain, expected) => {
      expect(localizeAccount(account(), accessDomain).acct).toBe(expected)
    }
  )

  it('strips a scheme from the access domain before comparing', () => {
    expect(localizeAccount(account(), 'https://llun.dev').acct).toBe('null')
  })

  it('never changes id/url — only acct', () => {
    const input = account({ acct: 'null' })
    const result = localizeAccount(input, 'llun.social')
    expect(result.url).toBe(input.url)
    expect(result.acct).toBe('null@llun.dev')
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
