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

// The real span, with what each call records on it kept for assertions.
const { spanRecords } = vi.hoisted(() => ({ spanRecords: [] as unknown[] }))
vi.mock('@/lib/utils/trace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/trace')>()
  return {
    ...actual,
    withSpan: ((op, name, data, fn) => {
      spanRecords.push(data)
      return actual.withSpan(op, name, data, (span) => {
        const setAttribute = span.setAttribute.bind(span)
        span.setAttribute = (key, value) => {
          spanRecords.push({ [key]: value })
          return setAttribute(key, value)
        }
        return fn(span)
      })
    }) as typeof actual.withSpan
  }
})

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
    vi.mocked(canFederateWithDomain).mockImplementation(
      async (_database, value) => new URL(value).host !== 'blocked.test'
    )
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

  it.each([
    ['refuses', async () => false],
    [
      'cannot decide',
      async () => {
        throw new Error('settings unavailable')
      }
    ]
  ])(
    'makes no request to a handle host federation policy %s',
    async (_label, policy) => {
      serve({
        [webfingerUrl]: { body: jrd('https://example.test/users/alice') }
      })
      vi.mocked(canFederateWithDomain).mockImplementation(policy)

      expect(
        await getWebfingerSelf({ account: 'alice@example.test' })
      ).toBeNull()
      expect(fetchMock).not.toHaveBeenCalled()
      expect(canFederateWithDomain).toHaveBeenCalledWith(
        mockDatabase,
        'https://example.test/.well-known/webfinger'
      )
    }
  )

  it('logs only the host when the WebFinger answer cannot be read', async () => {
    serve({ [webfingerUrl]: { body: 'not json' } })
    const error = vi.spyOn(logger, 'error')

    expect(await getWebfingerSelf({ account: 'alice@example.test' })).toBeNull()
    expect(error).toHaveBeenCalledWith({
      message: 'Failed to fetch webfinger self link',
      requestedHost: 'example.test',
      err: expect.any(Error)
    })
    // The JSON parse error's message quotes the body; a URL error carries
    // the requested URL. Only the error's name reaches the log.
    expect(error.mock.calls[0]?.[0]).toMatchObject({
      err: { message: 'WebFinger lookup failed: SyntaxError' }
    })
  })

  it('records only the host of the handle on its span', async () => {
    spanRecords.length = 0
    serve({})

    await getWebfingerSelf({ account: 'alice@example.test' })

    expect(spanRecords).toEqual([{}, { 'webfinger.host': 'example.test' }])
  })

  it.each([
    'alice@evil.test://allowed.example',
    'alice@https:/blocked.example',
    'alice@host/path',
    'alice@example.test?token=secret',
    'alice@example.test:abc?token=secret',
    'alice@https:8443',
    'alice@host.test/path/..'
  ])('refuses the non-bare domain in %s without a request', async (account) => {
    serve({})
    const warn = vi.spyOn(logger, 'warn')
    const error = vi.spyOn(logger, 'error')

    expect(await getWebfingerSelf({ account })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    // The refused value is never logged, in whole or in part.
    expect(
      JSON.stringify([...warn.mock.calls, ...error.mock.calls])
    ).not.toContain('secret')
  })
})
