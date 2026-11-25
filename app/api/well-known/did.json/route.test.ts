import { NextRequest } from 'next/server'

import type { Database } from '@/lib/database/types'
import {
  SERVED_DOMAIN_REFRESH_MS,
  refreshServedDomains,
  resetServedDomainsForTests,
  setServedDomainsForTests
} from '@/lib/services/domains/servedDomainSnapshot'
import { XRPC_VARY_HEADER } from '@/lib/services/pds'
import { STRICT_TRANSPORT_SECURITY_HEADER } from '@/lib/utils/http-headers/hsts'

import { GET, HEAD, OPTIONS } from './route'

const PDS_ENV = JSON.stringify({
  'social.example': {
    enabled: true,
    hostname: 'pds.social.example',
    allowEmails: [],
    allowActors: []
  },
  'disabled.example': {
    enabled: false,
    hostname: 'pds.disabled.example',
    allowEmails: [],
    allowActors: []
  },
  'port.example': {
    enabled: true,
    hostname: 'pds.port.example:8443',
    allowEmails: [],
    allowActors: []
  }
})

const makeRequest = (
  headers: Record<string, string>,
  method = 'GET',
  origin = 'https://pds.social.example'
): NextRequest =>
  new NextRequest(`${origin}/.well-known/did.json`, {
    method,
    headers
  })

describe('GET /.well-known/did.json', () => {
  const originalPdsEnv = process.env.ACTIVITIES_BLUESKY_PDS

  beforeEach(() => {
    process.env.ACTIVITIES_BLUESKY_PDS = PDS_ENV
    resetServedDomainsForTests()
    setServedDomainsForTests([])
  })

  afterEach(() => {
    vi.useRealTimers()
    resetServedDomainsForTests()
  })

  afterAll(() => {
    resetServedDomainsForTests()
    if (originalPdsEnv === undefined) {
      delete process.env.ACTIVITIES_BLUESKY_PDS
    } else {
      process.env.ACTIVITIES_BLUESKY_PDS = originalPdsEnv
    }
  })

  it('serves the did:web document for an enabled PDS hostname', async () => {
    const response = await GET(makeRequest({ host: 'pds.social.example' }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe(
      'application/json; charset=utf-8'
    )
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Vary')).toBe(XRPC_VARY_HEADER)
    expect(response.headers.get(STRICT_TRANSPORT_SECURITY_HEADER.key)).toBe(
      STRICT_TRANSPORT_SECURITY_HEADER.value
    )
    expect(await response.json()).toEqual({
      '@context': ['https://www.w3.org/ns/did/v1'],
      id: 'did:web:pds.social.example',
      service: [
        {
          id: '#atproto_pds',
          type: 'AtprotoPersonalDataServer',
          serviceEndpoint: 'https://pds.social.example'
        }
      ]
    })
  })

  it('respects X-Forwarded-Host and percent-encodes non-default ports in did:web', async () => {
    const response = await GET(
      makeRequest({
        host: 'internal:3000',
        'x-forwarded-host': 'pds.port.example:8443'
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      '@context': ['https://www.w3.org/ns/did/v1'],
      id: 'did:web:pds.port.example%3A8443',
      service: [
        {
          id: '#atproto_pds',
          type: 'AtprotoPersonalDataServer',
          serviceEndpoint: 'https://pds.port.example:8443'
        }
      ]
    })
  })

  it('handles HEAD and OPTIONS on an enabled PDS hostname', async () => {
    const headResponse = await HEAD(
      makeRequest({ host: 'pds.social.example' }, 'HEAD'),
      { params: Promise.resolve({}) }
    )
    expect(headResponse.status).toBe(200)
    expect(headResponse.body).toBeNull()
    expect(Number(headResponse.headers.get('Content-Length'))).toBeGreaterThan(
      0
    )
    expect(headResponse.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(headResponse.headers.get('Cache-Control')).toBe('no-store')
    expect(headResponse.headers.get('Vary')).toBe(XRPC_VARY_HEADER)
    expect(headResponse.headers.get(STRICT_TRANSPORT_SECURITY_HEADER.key)).toBe(
      STRICT_TRANSPORT_SECURITY_HEADER.value
    )

    const optionsResponse = await OPTIONS(
      makeRequest({ host: 'pds.social.example' }, 'OPTIONS')
    )
    expect(optionsResponse.status).toBe(204)
    expect(optionsResponse.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(optionsResponse.headers.get('Cache-Control')).toBe('no-store')
    expect(optionsResponse.headers.get('Vary')).toBe(XRPC_VARY_HEADER)
    expect(
      optionsResponse.headers.get(STRICT_TRANSPORT_SECURITY_HEADER.key)
    ).toBe(STRICT_TRANSPORT_SECURITY_HEADER.value)
  })

  it('omits HSTS over plain HTTP and on localhost, while keeping Cache-Control and Vary', async () => {
    const httpRes = await GET(
      makeRequest(
        { host: 'pds.social.example' },
        'GET',
        'http://pds.social.example'
      ),
      { params: Promise.resolve({}) }
    )
    expect(httpRes.status).toBe(200)
    expect(httpRes.headers.get(STRICT_TRANSPORT_SECURITY_HEADER.key)).toBeNull()
    expect(httpRes.headers.get('Cache-Control')).toBe('no-store')
    expect(httpRes.headers.get('Vary')).toBe(XRPC_VARY_HEADER)

    const localRes = await GET(
      makeRequest({ host: 'pds.social.example' }, 'GET', 'https://localhost'),
      { params: Promise.resolve({}) }
    )
    expect(localRes.status).toBe(200)
    expect(
      localRes.headers.get(STRICT_TRANSPORT_SECURITY_HEADER.key)
    ).toBeNull()
  })

  it.each([
    { label: 'primary domain', headers: { host: 'social.example' } },
    {
      label: 'disabled PDS hostname',
      headers: { host: 'pds.disabled.example' }
    },
    { label: 'unknown host', headers: { host: 'other.example' } },
    {
      label: 'comma-separated Host',
      headers: { host: 'pds.social.example, evil.example' }
    }
  ])(
    'answers 404 on $label for GET, HEAD, and OPTIONS',
    async ({ headers }) => {
      const getRes = await GET(makeRequest(headers, 'GET'), {
        params: Promise.resolve({})
      })
      expect(getRes.status).toBe(404)
      expect(getRes.headers.get('Cache-Control')).toBe('no-store')
      expect(getRes.headers.get('Vary')).toBe(XRPC_VARY_HEADER)
      expect(getRes.headers.get(STRICT_TRANSPORT_SECURITY_HEADER.key)).toBe(
        STRICT_TRANSPORT_SECURITY_HEADER.value
      )

      const headRes = await HEAD(makeRequest(headers, 'HEAD'), {
        params: Promise.resolve({})
      })
      expect(headRes.status).toBe(404)
      expect(headRes.body).toBeNull()
      expect(headRes.headers.get('Cache-Control')).toBe('no-store')
      expect(headRes.headers.get('Vary')).toBe(XRPC_VARY_HEADER)

      const optRes = await OPTIONS(makeRequest(headers, 'OPTIONS'))
      expect(optRes.status).toBe(404)
      expect(optRes.headers.get('Cache-Control')).toBe('no-store')
      expect(optRes.headers.get('Vary')).toBe(XRPC_VARY_HEADER)
      expect(optRes.headers.get(STRICT_TRANSPORT_SECURITY_HEADER.key)).toBe(
        STRICT_TRANSPORT_SECURITY_HEADER.value
      )
    }
  )

  it('answers 404 when ACTIVITIES_BLUESKY_PDS is unset', async () => {
    delete process.env.ACTIVITIES_BLUESKY_PDS

    const response = await GET(makeRequest({ host: 'pds.social.example' }), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(404)
  })

  it('answers 404 without querying served domains on OPTIONS when ACTIVITIES_BLUESKY_PDS is unset', async () => {
    vi.useFakeTimers()
    const getActiveServedDomains = vi.fn(async () => [])
    const mockDb = { getActiveServedDomains } as unknown as Database
    await refreshServedDomains(mockDb)
    expect(getActiveServedDomains).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(SERVED_DOMAIN_REFRESH_MS + 1)
    delete process.env.ACTIVITIES_BLUESKY_PDS

    const optionsRes = await OPTIONS(
      makeRequest({ host: 'pds.social.example' }, 'OPTIONS')
    )
    expect(optionsRes.status).toBe(404)
    expect(getActiveServedDomains).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the served-domain snapshot is unloaded and refreshes on OPTIONS before checking host collision', async () => {
    vi.useFakeTimers()

    // Unloaded snapshot -> GET, HEAD, and OPTIONS all fail closed with 404.
    resetServedDomainsForTests()
    expect(
      (
        await GET(makeRequest({ host: 'pds.social.example' }, 'GET'), {
          params: Promise.resolve({})
        })
      ).status
    ).toBe(404)
    expect(
      (
        await HEAD(makeRequest({ host: 'pds.social.example' }, 'HEAD'), {
          params: Promise.resolve({})
        })
      ).status
    ).toBe(404)
    expect(
      (await OPTIONS(makeRequest({ host: 'pds.social.example' }, 'OPTIONS')))
        .status
    ).toBe(404)

    // Register a DB whose active domains later include pds.social.example.
    const activeDomains: Array<{ domain: string }> = []
    const getActiveServedDomains = vi.fn(async () => activeDomains)
    const mockDb = { getActiveServedDomains } as unknown as Database
    await refreshServedDomains(mockDb)

    expect(
      (await OPTIONS(makeRequest({ host: 'pds.social.example' }, 'OPTIONS')))
        .status
    ).toBe(204)

    // After the refresh interval passes, OPTIONS must await ensureServedDomainsFresh()
    // and refuse the now-colliding hostname with 404.
    activeDomains.push({ domain: 'pds.social.example' })
    vi.advanceTimersByTime(SERVED_DOMAIN_REFRESH_MS + 1)

    const refreshedOpt = await OPTIONS(
      makeRequest({ host: 'pds.social.example' }, 'OPTIONS')
    )
    expect(refreshedOpt.status).toBe(404)
    expect(getActiveServedDomains).toHaveBeenCalledTimes(2)
  })
})
