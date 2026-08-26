import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getSafeImageDownloadUrl,
  isRestrictedDownloadAddress,
  isRestrictedDownloadHostname
} from './safeImageDownloadUrl'

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn()
}))

const { lookup } =
  await vi.importMock<typeof import('node:dns/promises')>('node:dns/promises')

const mockResolvesTo = (...addresses: string[]) => {
  vi.mocked(lookup).mockResolvedValue(
    addresses.map((address) => ({
      address,
      family: address.includes(':') ? 6 : 4
    })) as never
  )
}

describe('isRestrictedDownloadHostname', () => {
  it.each([
    { description: 'rejects localhost', hostname: 'localhost', expected: true },
    {
      description: 'rejects a .localhost subdomain',
      hostname: 'api.localhost',
      expected: true
    },
    {
      description: 'rejects an mDNS .local name',
      hostname: 'printer.local',
      expected: true
    },
    {
      description: 'rejects a cloud .internal name',
      hostname: 'metadata.google.internal',
      expected: true
    },
    {
      description: 'rejects a .home.arpa name',
      hostname: 'nas.home.arpa',
      expected: true
    },
    {
      description: 'allows an ordinary public hostname',
      hostname: 'images.example.com',
      expected: false
    }
  ])('$description', ({ hostname, expected }) => {
    expect(isRestrictedDownloadHostname(hostname)).toBe(expected)
  })
})

describe('isRestrictedDownloadAddress', () => {
  it.each([
    { description: 'rejects IPv4 loopback', address: '127.0.0.1' },
    { description: 'rejects the IPv4 private 10/8 range', address: '10.1.2.3' },
    {
      description: 'rejects the IPv4 private 192.168/16 range',
      address: '192.168.1.1'
    },
    {
      description: 'rejects IPv4 link-local metadata',
      address: '169.254.169.254'
    },
    { description: 'rejects the CGNAT range', address: '100.64.0.1' },
    { description: 'rejects IPv6 loopback', address: '::1' },
    { description: 'rejects an IPv6 unique-local address', address: 'fd00::1' },
    {
      description: 'rejects an IPv6 link-local address',
      address: 'fe80::1'
    },
    {
      description: 'fails closed on an unparseable address',
      address: 'not-an-address'
    }
  ])('$description', ({ address }) => {
    expect(isRestrictedDownloadAddress(address)).toBe(true)
  })

  it.each([
    { description: 'allows a public IPv4 address', address: '93.184.216.34' },
    { description: 'allows a public IPv6 address', address: '2606:2800:220::1' }
  ])('$description', ({ address }) => {
    expect(isRestrictedDownloadAddress(address)).toBe(false)
  })
})

describe('getSafeImageDownloadUrl', () => {
  beforeEach(() => {
    vi.mocked(lookup).mockReset()
  })

  it('returns the parsed url for a public https host', async () => {
    mockResolvesTo('93.184.216.34')
    const url = await getSafeImageDownloadUrl(
      'https://images.example.com/photo.jpg'
    )
    expect(url?.toString()).toBe('https://images.example.com/photo.jpg')
  })

  it.each([
    {
      description: 'rejects a plain http url',
      url: 'http://images.example.com/photo.jpg'
    },
    {
      description: 'rejects a non-http scheme',
      url: 'file:///etc/passwd'
    },
    {
      description: 'rejects a url carrying credentials',
      url: 'https://user:secret@images.example.com/photo.jpg'
    },
    {
      description: 'rejects an unparseable url',
      url: 'not a url at all'
    },
    {
      description: 'rejects a hostname that names the local network',
      url: 'https://metadata.google.internal/computeMetadata/v1/'
    }
  ])('$description', async ({ url }) => {
    expect(await getSafeImageDownloadUrl(url)).toBeNull()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('rejects a literal private IPv4 host without resolving it', async () => {
    expect(
      await getSafeImageDownloadUrl('https://169.254.169.254/latest/meta-data/')
    ).toBeNull()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('allows a literal public IPv4 host without resolving it', async () => {
    const url = await getSafeImageDownloadUrl('https://93.184.216.34/photo.jpg')
    expect(url?.hostname).toBe('93.184.216.34')
    expect(lookup).not.toHaveBeenCalled()
  })

  it('rejects a public hostname that resolves to a private address', async () => {
    mockResolvesTo('10.0.0.5')
    expect(
      await getSafeImageDownloadUrl('https://rebinding.example.com/photo.jpg')
    ).toBeNull()
  })

  // The guard checks EVERY resolved address, so a record mixing a public and a
  // private answer cannot smuggle the private one through by ordering.
  it('rejects when any one of several resolved addresses is private', async () => {
    mockResolvesTo('93.184.216.34', '192.168.1.10')
    expect(
      await getSafeImageDownloadUrl('https://mixed.example.com/photo.jpg')
    ).toBeNull()
  })

  it('rejects when the hostname does not resolve at all', async () => {
    vi.mocked(lookup).mockRejectedValue(new Error('ENOTFOUND'))
    expect(
      await getSafeImageDownloadUrl('https://missing.example.com/photo.jpg')
    ).toBeNull()
  })

  it('rejects when the hostname resolves to an empty address list', async () => {
    mockResolvesTo()
    expect(
      await getSafeImageDownloadUrl('https://empty.example.com/photo.jpg')
    ).toBeNull()
  })
})
