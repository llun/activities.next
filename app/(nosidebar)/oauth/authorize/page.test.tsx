import { getBaseURL, getConfig } from '@/lib/config'
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
