import type { ReactElement } from 'react'

import { getBaseURL, getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import Page from './page'

vi.mock('@/lib/config')

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => ({}))
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue(null)
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn().mockResolvedValue(null)
}))

const redirectMock = vi.fn((path: string) => path)
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('Unexpected notFound')
  }),
  redirect: (path: string) => redirectMock(path)
}))

const headersMock = vi.fn()
vi.mock('next/headers', () => ({
  headers: () => headersMock()
}))

const ALIAS_HOST = 'alias.llun.dev'

const searchParams = {
  client_id: 'client-id',
  scope: 'read',
  redirect_uri: 'https://app.example/callback',
  response_type: 'code' as const
}

describe('/oauth/authorize redirect host', () => {
  beforeEach(() => {
    redirectMock.mockClear()
    vi.mocked(getConfig).mockReturnValue({
      host: TEST_DOMAIN,
      trustedHosts: [ALIAS_HOST]
    } as ReturnType<typeof getConfig>)
    vi.mocked(getBaseURL).mockReturnValue(`https://${TEST_DOMAIN}`)
    vi.mocked(getActorFromSession).mockResolvedValue(null)
  })

  it.each([
    {
      description: 'keeps an unauthenticated login on the trusted request host',
      requestHost: ALIAS_HOST,
      expectedHost: ALIAS_HOST
    },
    {
      description:
        'falls back to the configured host for an untrusted request host',
      requestHost: 'evil.example',
      expectedHost: TEST_DOMAIN
    }
  ])('sign-in redirect $description', async ({ requestHost, expectedHost }) => {
    headersMock.mockReturnValue(
      new Headers({ 'x-forwarded-host': requestHost })
    )

    await Page({ searchParams: Promise.resolve(searchParams) })

    expect(redirectMock).toHaveBeenCalledTimes(1)
    const target = new URL(redirectMock.mock.calls[0][0])
    expect(target.host).toBe(expectedHost)
    expect(target.pathname).toBe('/auth/signin')
  })

  it('uses the configured scheme rather than hardcoding https', async () => {
    vi.mocked(getBaseURL).mockReturnValue(`http://${TEST_DOMAIN}`)
    headersMock.mockReturnValue(new Headers({ 'x-forwarded-host': ALIAS_HOST }))

    await Page({ searchParams: Promise.resolve(searchParams) })

    const target = new URL(redirectMock.mock.calls[0][0])
    expect(target.protocol).toBe('http:')
    expect(target.host).toBe(ALIAS_HOST)
  })

  it('does not carry over the configured host port to a portless request host', async () => {
    vi.mocked(getBaseURL).mockReturnValue(`https://${TEST_DOMAIN}:8443`)
    vi.mocked(getConfig).mockReturnValue({
      host: `${TEST_DOMAIN}:8443`,
      trustedHosts: [ALIAS_HOST]
    } as ReturnType<typeof getConfig>)
    headersMock.mockReturnValue(new Headers({ 'x-forwarded-host': ALIAS_HOST }))

    await Page({ searchParams: Promise.resolve(searchParams) })

    const target = new URL(redirectMock.mock.calls[0][0])
    expect(target.host).toBe(ALIAS_HOST)
    expect(target.port).toBe('')
  })

  it('delegates an authenticated consent redirect to the trusted request host', async () => {
    vi.mocked(getActorFromSession).mockResolvedValue({
      id: 'actor-id',
      account: { id: 'account-id' }
    } as Awaited<ReturnType<typeof getActorFromSession>>)
    headersMock.mockReturnValue(new Headers({ 'x-forwarded-host': ALIAS_HOST }))

    // No sig/exp -> shouldDelegateToBetterAuth is true.
    await Page({ searchParams: Promise.resolve(searchParams) })

    expect(redirectMock).toHaveBeenCalledTimes(1)
    const target = new URL(redirectMock.mock.calls[0][0])
    expect(target.host).toBe(ALIAS_HOST)
    expect(target.pathname).toBe('/api/auth/oauth2/authorize')
  })
})

describe('/oauth/authorize Mastodon authorize params', () => {
  beforeEach(() => {
    redirectMock.mockClear()
    vi.mocked(getConfig).mockReturnValue({
      host: TEST_DOMAIN,
      trustedHosts: []
    } as ReturnType<typeof getConfig>)
    vi.mocked(getBaseURL).mockReturnValue(`https://${TEST_DOMAIN}`)
    vi.mocked(getActorFromSession).mockResolvedValue(null)
    headersMock.mockReturnValue(
      new Headers({ 'x-forwarded-host': TEST_DOMAIN })
    )
  })

  it('defaults a missing scope to read instead of returning 404', async () => {
    await Page({
      searchParams: Promise.resolve({
        client_id: 'client-id',
        redirect_uri: 'https://app.example/callback',
        response_type: 'code'
      })
    })

    expect(redirectMock).toHaveBeenCalledTimes(1)
    const target = new URL(redirectMock.mock.calls[0][0])
    expect(target.pathname).toBe('/auth/signin')
    const redirectBack = new URLSearchParams(
      (target.searchParams.get('redirectBack') as string).split('?')[1]
    )
    expect(redirectBack.get('scope')).toBe('read')
  })

  it('delegates with the defaulted read scope for an authenticated session', async () => {
    vi.mocked(getActorFromSession).mockResolvedValue({
      id: 'actor-id',
      account: { id: 'account-id' }
    } as Awaited<ReturnType<typeof getActorFromSession>>)

    await Page({
      searchParams: Promise.resolve({
        client_id: 'client-id',
        redirect_uri: 'https://app.example/callback',
        response_type: 'code'
      })
    })

    const target = new URL(redirectMock.mock.calls[0][0])
    expect(target.pathname).toBe('/api/auth/oauth2/authorize')
    expect(target.searchParams.get('scope')).toBe('read')
  })

  it('accepts the Mastodon lang param and never forwards it', async () => {
    // Regression pin: before this change lang was silently stripped by Zod;
    // now it is an explicit schema member that must still not leak into
    // forwarded queries.
    await Page({
      searchParams: Promise.resolve({ ...searchParams, lang: 'fr' })
    })

    expect(redirectMock).toHaveBeenCalledTimes(1)
    const target = new URL(redirectMock.mock.calls[0][0])
    expect(target.pathname).toBe('/auth/signin')
    const redirectBack = new URLSearchParams(
      (target.searchParams.get('redirectBack') as string).split('?')[1]
    )
    expect(redirectBack.has('lang')).toBe(false)
  })

  it('redirects an authenticated session to sign-in when force_login is true', async () => {
    vi.mocked(getActorFromSession).mockResolvedValue({
      id: 'actor-id',
      account: { id: 'account-id' }
    } as Awaited<ReturnType<typeof getActorFromSession>>)

    await Page({
      searchParams: Promise.resolve({ ...searchParams, force_login: 'true' })
    })

    expect(redirectMock).toHaveBeenCalledTimes(1)
    const target = new URL(redirectMock.mock.calls[0][0])
    expect(target.pathname).toBe('/auth/signin')
    expect(target.searchParams.get('force_login')).toBe('true')
    // redirectBack must NOT carry force_login or the resumed request would
    // bounce straight back to sign-in forever.
    const redirectBack = new URLSearchParams(
      (target.searchParams.get('redirectBack') as string).split('?')[1]
    )
    expect(redirectBack.has('force_login')).toBe(false)
    expect(redirectBack.get('client_id')).toBe('client-id')
  })

  it('proceeds with the active session when force_login is false', async () => {
    // Regression pin: a falsy force_login must not force re-authentication
    // and must not leak into the delegated better-auth query.
    vi.mocked(getActorFromSession).mockResolvedValue({
      id: 'actor-id',
      account: { id: 'account-id' }
    } as Awaited<ReturnType<typeof getActorFromSession>>)

    await Page({
      searchParams: Promise.resolve({ ...searchParams, force_login: 'false' })
    })

    const target = new URL(redirectMock.mock.calls[0][0])
    expect(target.pathname).toBe('/api/auth/oauth2/authorize')
    expect(target.searchParams.has('force_login')).toBe(false)
  })
})

describe('/oauth/authorize account summary', () => {
  beforeEach(() => {
    redirectMock.mockClear()
    vi.mocked(getConfig).mockReturnValue({
      host: TEST_DOMAIN,
      trustedHosts: []
    } as ReturnType<typeof getConfig>)
    vi.mocked(getBaseURL).mockReturnValue(`https://${TEST_DOMAIN}`)
    headersMock.mockReturnValue(
      new Headers({ 'x-forwarded-host': TEST_DOMAIN })
    )
  })

  it.each([
    {
      description: 'a fully-populated account',
      accountName: 'Ride' as string | null,
      accountIconUrl: 'https://cdn.example/a.png' as string | null,
      expectedIconUrl: 'https://cdn.example/a.png' as string | null
    },
    {
      description:
        'an account with no name or avatar (nulls propagate as null)',
      accountName: null as string | null,
      accountIconUrl: null as string | null,
      expectedIconUrl: null as string | null
    },
    {
      description:
        'an account whose avatar is a generated placeholder (filtered to null)',
      accountName: 'Ride' as string | null,
      accountIconUrl: 'https://www.gravatar.com/avatar/abc123' as string | null,
      expectedIconUrl: null as string | null
    }
  ])(
    'passes the account summary from actor.account to AuthorizeCard for $description',
    async ({ accountName, accountIconUrl, expectedIconUrl }) => {
      vi.mocked(getActorFromSession).mockResolvedValue({
        id: 'https://activities.local/users/llun',
        account: {
          id: 'account-id',
          email: 'rider@example.com',
          name: accountName,
          iconUrl: accountIconUrl
        }
      } as Awaited<ReturnType<typeof getActorFromSession>>)

      vi.mocked(getDatabase).mockReturnValue({
        getClientFromId: vi.fn().mockResolvedValue({
          clientId: 'client-id',
          redirectUris: ['https://app.example/callback']
        }),
        getActorsForAccount: vi.fn().mockResolvedValue([])
      } as unknown as ReturnType<typeof getDatabase>)

      // A live sig/exp pair keeps shouldDelegateToBetterAuth false so the page
      // renders AuthorizeCard instead of redirecting.
      const renderParams = {
        client_id: 'client-id',
        scope: 'openid profile email',
        redirect_uri: 'https://app.example/callback',
        response_type: 'code' as const,
        sig: 'signed',
        exp: '9999999999'
      }

      const element = (await Page({
        searchParams: Promise.resolve(renderParams)
      })) as ReactElement

      expect(redirectMock).not.toHaveBeenCalled()
      // Page returns <div><AuthorizeCard .../></div>; the account summary must
      // be sourced from actor.account (a typo passing the actor would fail
      // here), nullish name/iconUrl must propagate, and a generated-placeholder
      // avatar is filtered to null (consistent with the rest of the account UI).
      const authorizeCard = (element.props as { children: ReactElement })
        .children
      expect((authorizeCard.props as { account: unknown }).account).toEqual({
        email: 'rider@example.com',
        name: accountName,
        iconUrl: expectedIconUrl
      })
    }
  )
})
