import dns from 'node:dns'
import { lookup } from 'node:dns/promises'

import {
  guardedPushLookup,
  isAllowedPushEndpoint,
  isDeliverablePushEndpoint,
  pushDeliveryAgent
} from './pushEndpoint'

// Regression (F125): push endpoints were accepted as any `z.string().url()`
// and POSTed to on every notification, straight from the server.
const RESTRICTED_ENDPOINTS = [
  'http://push.example.com/endpoint',
  'https://user:pass@push.example.com/endpoint',
  'https://localhost/endpoint',
  'https://push.internal/endpoint',
  'https://127.0.0.1/endpoint',
  'https://10.0.0.5/endpoint',
  'https://169.254.169.254/latest/meta-data',
  'https://[::1]/endpoint',
  'not a url'
]

describe('isAllowedPushEndpoint', () => {
  it('accepts a public https push service', async () => {
    await expect(
      isAllowedPushEndpoint('https://push.example.com/endpoint/abc')
    ).resolves.toBe(true)
  })

  it.each(RESTRICTED_ENDPOINTS)('refuses %s', async (endpoint: string) => {
    await expect(isAllowedPushEndpoint(endpoint)).resolves.toBe(false)
  })

  it('refuses a name that resolves to a private address', async () => {
    vi.mocked(lookup).mockResolvedValueOnce([
      { address: '10.1.2.3', family: 4 }
    ] as never)

    await expect(
      isAllowedPushEndpoint('https://push.attacker.example/endpoint')
    ).resolves.toBe(false)
  })
})

describe('isDeliverablePushEndpoint', () => {
  it('accepts a public https push service name', () => {
    expect(isDeliverablePushEndpoint('https://push.example.com/x')).toBe(true)
  })

  it.each(RESTRICTED_ENDPOINTS)('refuses %s', (endpoint: string) => {
    expect(isDeliverablePushEndpoint(endpoint)).toBe(false)
  })
})

describe('guardedPushLookup', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  type LookupOptions = { all?: boolean }

  const resolve = (hostname: string, options: LookupOptions = {}) =>
    new Promise<{
      error: NodeJS.ErrnoException | null
      address: unknown
      family: unknown
    }>((done) => {
      guardedPushLookup(hostname, options, (error, address, family) =>
        done({ error, address, family })
      )
    })

  // Behaves like the real dns.lookup: ONE address unless `all: true` is
  // asked for. A stub that always returned the whole record would let the
  // guard drop its forced `all: true` and still look like it checks every
  // answer.
  const stubLookup = (addresses: { address: string; family: number }[]) =>
    vi
      .spyOn(dns, 'lookup')
      .mockImplementation(((
        _hostname: string,
        options: LookupOptions,
        callback: (error: null, address: unknown, family?: number) => void
      ) =>
        options.all
          ? callback(null, addresses)
          : callback(null, addresses[0].address, addresses[0].family)) as never)

  // Node's net layer calls the lookup with `all: true` when it races address
  // families (autoSelectFamily, on by default in Node 24) and without it
  // otherwise; the guard must refuse a mixed record either way.
  const CALLER_OPTIONS: [string, LookupOptions][] = [
    ['default options', {}],
    ['all: true', { all: true }]
  ]

  // Checked at CONNECT time, on the addresses the socket will use, so a
  // record rebound to a private address after subscribe is still refused.
  it.each(CALLER_OPTIONS)(
    'refuses a host that resolves to a private address (%s)',
    async (_, options) => {
      stubLookup([{ address: '192.168.1.10', family: 4 }])

      const { error } = await resolve('push.example.com', options)

      expect(error?.message).toMatch(/restricted address/)
    }
  )

  it.each(CALLER_OPTIONS)(
    'refuses a host when any one of its addresses is private (%s)',
    async (_, options) => {
      // The public answer comes FIRST: a guard that looked only at the
      // address the socket would pick by default would let this through.
      stubLookup([
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 }
      ])

      const { error } = await resolve('push.example.com', options)

      expect(error?.message).toMatch(/restricted address/)
    }
  )

  it('passes a public address through as (address, family) by default', async () => {
    stubLookup([{ address: '93.184.216.34', family: 4 }])

    const { error, address, family } = await resolve('push.example.com')

    expect(error).toBeNull()
    expect(address).toBe('93.184.216.34')
    expect(family).toBe(4)
  })

  it('passes the public record through as an array when asked for all', async () => {
    const record = [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }
    ]
    stubLookup(record)

    const { error, address } = await resolve('push.example.com', {
      all: true
    })

    expect(error).toBeNull()
    expect(address).toEqual(record)
  })

  it('is the lookup the delivery agent connects through', () => {
    expect(
      (pushDeliveryAgent as unknown as { options: { lookup?: unknown } })
        .options.lookup
    ).toBe(guardedPushLookup)
  })
})
