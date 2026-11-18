import { enableFetchMocks } from 'jest-fetch-mock'

import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { logger } from '@/lib/utils/logger'

// Read by the request layer's server-settings lookup.
const mockDatabase = { getAllServerSettings: async () => [] }
vi.mock('@/lib/database', () => ({ getDatabase: () => mockDatabase }))
vi.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: vi.fn()
}))

enableFetchMocks()

// Runs through the real request layer (unlike getWebfingerSelf.test.ts), so a
// redirect is followed or refused exactly as in production.
describe('getWebfingerSelf redirects', () => {
  const webfingerUrl =
    'https://example.test/.well-known/webfinger?resource=acct%3Aalice%40example.test'
  const jrd = (href: string) =>
    JSON.stringify({
      subject: 'acct:alice@example.test',
      links: [{ rel: 'self', type: 'application/activity+json', href }]
    })

  const serve = (
    routes: Record<
      string,
      { body?: string; status?: number; headers?: Record<string, string> }
    >
  ) => {
    fetchMock.resetMocks()
    fetchMock.mockResponse(async (req) => {
      const route = routes[req.url]
      if (!route) return { status: 404, body: 'Not Found' }
      return {
        status: route.status ?? 200,
        body: route.body ?? '',
        headers: { 'content-type': 'application/jrd+json', ...route.headers }
      }
    })
  }

  beforeEach(() => {
    vi.mocked(canFederateWithDomain).mockReset().mockResolvedValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('follows a cross-host redirect onto a host federation policy allows', async () => {
    const socialUrl =
      'https://social.example.test/.well-known/webfinger?resource=acct%3Aalice%40example.test'
    serve({
      [webfingerUrl]: { status: 302, headers: { location: socialUrl } },
      [socialUrl]: { body: jrd('https://social.example.test/users/alice') }
    })

    expect(await getWebfingerSelf({ account: 'alice@example.test' })).toBe(
      'https://social.example.test/users/alice'
    )
    expect(canFederateWithDomain).toHaveBeenCalledWith(mockDatabase, socialUrl)
  })

  it('does not follow a redirect onto a host federation policy refuses', async () => {
    const blockedUrl =
      'https://blocked.test/.well-known/webfinger?resource=acct%3Aalice%40example.test'
    serve({
      [webfingerUrl]: { status: 302, headers: { location: blockedUrl } },
      [blockedUrl]: { body: jrd('https://blocked.test/users/alice') }
    })
    vi.mocked(canFederateWithDomain).mockResolvedValue(false)
    const warn = vi.spyOn(logger, 'warn')
    const error = vi.spyOn(logger, 'error')

    expect(await getWebfingerSelf({ account: 'alice@example.test' })).toBeNull()
    expect(
      fetchMock.mock.calls.filter(([url]) => url === blockedUrl)
    ).toHaveLength(0)
    // A policy refusal, not a failure.
    expect(warn).toHaveBeenCalledWith({
      message: 'Refused a WebFinger redirect to another host',
      requestedHost: 'example.test',
      refusedRedirectHost: 'blocked.test'
    })
    expect(error).not.toHaveBeenCalled()
  })

  it('logs only the host of a handle that carries a query', async () => {
    const requested = new URL(
      'https://example.test?token=secret/.well-known/webfinger'
    )
    requested.searchParams.set(
      'resource',
      'acct:alice@example.test?token=secret'
    )
    serve({
      [requested.toString()]: {
        status: 302,
        headers: { location: 'https://blocked.test/.well-known/webfinger' }
      }
    })
    vi.mocked(canFederateWithDomain).mockResolvedValue(false)
    const warn = vi.spyOn(logger, 'warn')

    expect(
      await getWebfingerSelf({ account: 'alice@example.test?token=secret' })
    ).toBeNull()
    expect(warn).toHaveBeenCalledWith({
      message: 'Refused a WebFinger redirect to another host',
      requestedHost: 'example.test',
      refusedRedirectHost: 'blocked.test'
    })
  })
})
