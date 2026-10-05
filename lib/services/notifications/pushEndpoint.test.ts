import dns from 'node:dns'
import { lookup } from 'node:dns/promises'

import {
  guardedPushLookup,
  isAllowedPushEndpoint,
  isDeliverablePushEndpoint
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

  const resolve = (hostname: string) =>
    new Promise<{ error: NodeJS.ErrnoException | null; address: unknown }>(
      (done) => {
        guardedPushLookup(hostname, {}, (error, address) =>
          done({ error, address })
        )
      }
    )

  const stubLookup = (addresses: { address: string; family: number }[]) =>
    vi
      .spyOn(dns, 'lookup')
      .mockImplementation(((
        _hostname: string,
        _options: unknown,
        callback: (error: null, addresses: unknown) => void
      ) => callback(null, addresses)) as never)

  // Checked at CONNECT time, on the addresses the socket will use, so a
  // record rebound to a private address after subscribe is still refused.
  it('refuses a host that resolves to a private address', async () => {
    stubLookup([{ address: '192.168.1.10', family: 4 }])

    const { error } = await resolve('push.example.com')

    expect(error?.message).toMatch(/restricted address/)
  })

  it('refuses a host when any one of its addresses is private', async () => {
    stubLookup([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 }
    ])

    const { error } = await resolve('push.example.com')

    expect(error).not.toBeNull()
  })

  it('passes a public address through', async () => {
    stubLookup([{ address: '93.184.216.34', family: 4 }])

    const { error, address } = await resolve('push.example.com')

    expect(error).toBeNull()
    expect(address).toBe('93.184.216.34')
  })
})
