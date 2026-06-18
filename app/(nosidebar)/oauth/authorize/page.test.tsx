import { getConfig } from '@/lib/config'
import { TEST_DOMAIN } from '@/lib/stub/const'

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

describe('/oauth/authorize sign-in redirect host', () => {
  beforeEach(() => {
    redirectMock.mockClear()
    vi.mocked(getConfig).mockReturnValue({
      host: TEST_DOMAIN,
      trustedHosts: [ALIAS_HOST]
    } as ReturnType<typeof getConfig>)
  })

  it('keeps an unauthenticated login on the trusted request host', async () => {
    headersMock.mockReturnValue(new Headers({ 'x-forwarded-host': ALIAS_HOST }))

    await Page({ searchParams: Promise.resolve(searchParams) })

    expect(redirectMock).toHaveBeenCalledTimes(1)
    const target = new URL(redirectMock.mock.calls[0][0])
    expect(target.host).toBe(ALIAS_HOST)
    expect(target.pathname).toBe('/auth/signin')
  })

  it('falls back to the configured host for an untrusted request host', async () => {
    headersMock.mockReturnValue(
      new Headers({ 'x-forwarded-host': 'evil.example' })
    )

    await Page({ searchParams: Promise.resolve(searchParams) })

    expect(redirectMock).toHaveBeenCalledTimes(1)
    const target = new URL(redirectMock.mock.calls[0][0])
    expect(target.host).toBe(TEST_DOMAIN)
  })
})
