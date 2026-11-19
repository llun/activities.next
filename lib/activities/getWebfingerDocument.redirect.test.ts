import { enableFetchMocks } from 'jest-fetch-mock'

import { getWebfingerDocument } from '@/lib/activities/getWebfingerDocument'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'

// Read by the request layer's server-settings lookup.
const mockDatabase = { getAllServerSettings: async () => [] }
vi.mock('@/lib/database', () => ({ getDatabase: () => mockDatabase }))
vi.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: vi.fn()
}))

enableFetchMocks()

// Runs through the real request layer, so a redirect is followed or refused
// exactly as in production.
describe('getWebfingerDocument redirects', () => {
  const webfingerUrl =
    'https://example.test/.well-known/webfinger?resource=acct%3Aalice%40example.test'
  const jrd = JSON.stringify({
    subject: 'acct:alice@example.test',
    links: [
      {
        rel: 'self',
        type: 'application/activity+json',
        href: 'https://example.test/users/alice'
      }
    ]
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
      [socialUrl]: { body: jrd }
    })

    const document = await getWebfingerDocument({
      account: 'alice@example.test'
    })

    expect(document?.subject).toEqual('acct:alice@example.test')
    // The default policy is consulted for the hop, not skipped.
    expect(canFederateWithDomain).toHaveBeenCalledWith(mockDatabase, socialUrl)
  })

  it('does not follow a redirect onto a host federation policy refuses', async () => {
    const blockedUrl =
      'https://blocked.test/.well-known/webfinger?resource=acct%3Aalice%40example.test'
    serve({
      [webfingerUrl]: { status: 302, headers: { location: blockedUrl } },
      [blockedUrl]: { body: jrd }
    })
    vi.mocked(canFederateWithDomain).mockResolvedValue(false)

    expect(
      await getWebfingerDocument({ account: 'alice@example.test' })
    ).toBeNull()
    expect(
      fetchMock.mock.calls.filter(([url]) => url === blockedUrl)
    ).toHaveLength(0)
  })
})
