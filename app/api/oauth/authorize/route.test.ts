import { NextRequest } from 'next/server'

import { resolveAuthBaseURL } from '@/lib/services/auth/requestOrigin'

import { GET, POST } from './route'

vi.mock('@/lib/config', () => ({
  getConfig: vi
    .fn()
    .mockReturnValue({
      host: 'activities.local',
      trustedHosts: ['alias.local']
    })
}))

vi.mock('@/lib/services/auth/requestOrigin', () => ({
  resolveAuthBaseURL: vi.fn()
}))

vi.mock('@/lib/services/oauth/logging', () => ({
  oauthLogger: { info: vi.fn(), error: vi.fn() },
  sanitizeHeaders: vi.fn(() => ({})),
  sanitizeParams: vi.fn((params) => params)
}))

describe('/api/oauth/authorize redirect host', () => {
  beforeEach(() => {
    vi.mocked(resolveAuthBaseURL).mockReset()
  })

  it('GET keeps the redirect on the resolved request host and preserves the query', () => {
    vi.mocked(resolveAuthBaseURL).mockReturnValue('https://alias.local')
    const req = new NextRequest(
      'https://alias.local/api/oauth/authorize?client_id=abc&response_type=code&scope=read'
    )

    const res = GET(req)

    expect(res.status).toBe(302)
    const url = new URL(res.headers.get('location') as string)
    expect(url.host).toBe('alias.local')
    expect(url.pathname).toBe('/api/auth/oauth2/authorize')
    expect(url.searchParams.get('client_id')).toBe('abc')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe('read')
    expect(vi.mocked(resolveAuthBaseURL)).toHaveBeenCalledWith(
      req.headers,
      expect.anything()
    )
  })

  it('falls back to the host resolveAuthBaseURL returns for an untrusted request host', () => {
    // selectHeaderHost (inside resolveAuthBaseURL) falls back to the configured
    // host for untrusted hosts; the route just uses whatever it returns.
    vi.mocked(resolveAuthBaseURL).mockReturnValue('https://activities.local')
    const req = new NextRequest(
      'https://evil.example/api/oauth/authorize?client_id=abc'
    )

    const res = GET(req)

    const url = new URL(res.headers.get('location') as string)
    expect(url.host).toBe('activities.local')
  })

  it('POST merges form-body params and redirects to the resolved host', async () => {
    vi.mocked(resolveAuthBaseURL).mockReturnValue('https://alias.local')
    const req = new NextRequest(
      'https://alias.local/api/oauth/authorize?client_id=abc',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'scope=read+write&response_type=code'
      }
    )

    const res = await POST(req)

    expect(res.status).toBe(302)
    const url = new URL(res.headers.get('location') as string)
    expect(url.host).toBe('alias.local')
    expect(url.pathname).toBe('/api/auth/oauth2/authorize')
    expect(url.searchParams.get('client_id')).toBe('abc')
    expect(url.searchParams.get('scope')).toBe('read write')
    expect(url.searchParams.get('response_type')).toBe('code')
  })
})
