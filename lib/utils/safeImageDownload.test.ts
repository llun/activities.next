import { createServer } from 'node:http'
import { AddressInfo } from 'node:net'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { afterEach } from 'vitest'

import {
  MAX_SAFE_IMAGE_REDIRECTS,
  getSafeImageDownloadUrl,
  isRestrictedDownloadAddress,
  isRestrictedDownloadHostname,
  safeImageFetch
} from './safeImageDownload'
import { DEFAULT_SAFE_REMOTE_FETCH_MAX_REDIRECTS } from './safeRemoteFetch'
import { isUnsafeAddress } from './unsafeAddress'

// `node:dns/promises` is already mocked globally in `vitest.setup.ts`; this
// just takes a typed handle on that mock.
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

// The loop test asserts `MAX_SAFE_IMAGE_REDIRECTS + 1` fetches, which proves
// the loop obeys the cap but not that the cap is small — widening it to 100
// would keep every test green. The comment on the constant says it tracks
// `safeRemoteFetch`'s ceiling, so pin that claim.
describe('MAX_SAFE_IMAGE_REDIRECTS', () => {
  it('tracks the ceiling safeRemoteFetch applies', () => {
    expect(MAX_SAFE_IMAGE_REDIRECTS).toBe(
      DEFAULT_SAFE_REMOTE_FETCH_MAX_REDIRECTS
    )
  })

  it('stays a small number', () => {
    expect(MAX_SAFE_IMAGE_REDIRECTS).toBe(3)
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

  // Stripping the brackets off a literal handed the decision to the BlockList.
  // It resolves the IPv4-MAPPED form against the IPv4 rules on its own, but not
  // these — so each needs its own subnet or a literal reaches the address it
  // encodes on any host with the matching gateway.
  it.each([
    {
      description: 'rejects an IPv4-mapped loopback',
      address: '::ffff:127.0.0.1'
    },
    {
      description: 'rejects an IPv4-mapped metadata address',
      address: '::ffff:169.254.169.254'
    },
    {
      description: 'rejects an IPv4-compatible loopback',
      address: '::127.0.0.1'
    },
    {
      description: 'rejects an IPv4-compatible loopback in hex form',
      address: '::7f00:1'
    },
    {
      description: 'rejects a well-known NAT64 metadata address',
      address: '64:ff9b::a9fe:a9fe'
    },
    {
      description: 'rejects an RFC 8215 local-use NAT64 address',
      address: '64:ff9b:1::a9fe:a9fe'
    },
    { description: 'rejects a 6to4 loopback', address: '2002:7f00:1::' },
    {
      description: 'rejects the 6to4 relay anycast range',
      address: '192.88.99.1'
    },
    {
      description: 'rejects the RFC 6666 discard prefix',
      address: '100::1'
    },
    { description: 'rejects a Teredo address', address: '2001::1' },
    { description: 'rejects an ORCHID address', address: '2001:10::1' },
    { description: 'rejects an ORCHIDv2 address', address: '2001:20::1' }
  ])('$description', ({ address }) => {
    expect(isRestrictedDownloadAddress(address)).toBe(true)
  })

  // NAT64 and the IPv4-compatible range carry an IPv4 destination. Blocking the
  // whole prefix would refuse every public IPv4-only origin on a DNS64/NAT64
  // deployment, so the embedded address is what decides — the same call
  // `safeRemoteFetch` makes.
  it.each([
    { description: 'allows a public IPv4 address', address: '93.184.216.34' },
    {
      description: 'allows a public IPv6 address',
      address: '2606:2800:220::1'
    },
    {
      description: 'allows a NAT64 address embedding a public IPv4',
      address: '64:ff9b::5db8:d822'
    },
    {
      description: 'allows an IPv4-compatible address embedding a public IPv4',
      address: '::93.184.216.34'
    },
    {
      description: 'allows an IPv4-mapped address embedding a public IPv4',
      address: '::ffff:93.184.216.34'
    }
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

describe('getSafeImageDownloadUrl IPv6 literals', () => {
  beforeEach(() => {
    vi.mocked(lookup).mockReset()
  })

  // A bracketed literal makes `isIP` answer 0, which used to push EVERY IPv6
  // URL down the DNS branch — where resolving an address rather than a name
  // fails, so `[::1]` was refused for the wrong reason and a public literal was
  // refused too. The blocklist should be what decides.
  it('rejects an IPv6 loopback literal via the blocklist', async () => {
    expect(await getSafeImageDownloadUrl('https://[::1]/x.jpg')).toBeNull()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('rejects an IPv6 unique-local literal', async () => {
    expect(await getSafeImageDownloadUrl('https://[fd00::1]/x.jpg')).toBeNull()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('allows a public IPv6 literal without resolving it', async () => {
    const url = await getSafeImageDownloadUrl(
      'https://[2606:2800:220::1]/x.jpg'
    )
    expect(url?.hostname).toBe('[2606:2800:220::1]')
    expect(lookup).not.toHaveBeenCalled()
  })
})

describe('safeImageFetch redirect handling', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.mocked(lookup).mockResolvedValue([
      { address: '93.184.216.34', family: 4 }
    ] as never)
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const redirectTo = (location: string | null, status = 302) =>
    new Response(null, {
      status,
      ...(location ? { headers: { location } } : {})
    })

  const imageResponse = () =>
    new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'image/jpeg' }
    })

  // A caller's `signal` is COMBINED with each hop's own timeout, never
  // substituted for it. Both halves are invisible in a result — the archive
  // passes the same value for both, so `signal ?? hopTimeout` and dropping
  // `signal` from the composite each leave every other test in the repo green
  // while silently removing one of the two bounds.
  it('aborts a hop when the caller signal fires, keeping the per-hop timeout', async () => {
    fetchMock.mockResolvedValue(imageResponse())
    const controller = new AbortController()

    await safeImageFetch('https://images.example/a.jpg', {
      // Long enough that only the caller's signal can be responsible.
      timeoutMs: 60_000,
      signal: controller.signal
    })

    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    expect(signal.aborted).toBe(false)
    controller.abort()
    expect(signal.aborted).toBe(true)
  })

  it('aborts a hop when the per-hop timeout fires, even with a live caller signal', async () => {
    fetchMock.mockResolvedValue(imageResponse())
    // Never aborts on its own, so only the hop timeout can trip the composite.
    const controller = new AbortController()

    await safeImageFetch('https://images.example/a.jpg', {
      timeoutMs: 5,
      signal: controller.signal
    })

    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(signal.aborted).toBe(true)
  })

  // The load-bearing option. `fetch` defaults to `redirect: 'follow'`, which
  // would carry the request to a target the guard never inspected — so each hop
  // must be requested in manual mode for the loop below to mean anything.
  it('requests every hop in manual redirect mode', async () => {
    fetchMock.mockResolvedValue(imageResponse())

    await safeImageFetch('https://cdn.example/photo.jpg')

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ redirect: 'manual' })
    )
  })

  it('returns a non-redirect response directly', async () => {
    fetchMock.mockResolvedValue(imageResponse())

    const response = await safeImageFetch('https://cdn.example/photo.jpg')
    expect(response?.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('follows a redirect to another safe host', async () => {
    fetchMock
      .mockResolvedValueOnce(redirectTo('https://other.example/real.jpg'))
      .mockResolvedValueOnce(imageResponse())

    const response = await safeImageFetch('https://cdn.example/photo.jpg')
    expect(response?.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  // The whole point: the guard re-runs on the TARGET, so a redirect into the
  // local network is refused before any request is made to it.
  it.each([
    {
      description: 'refuses a redirect to link-local metadata',
      location: 'https://169.254.169.254/latest/meta-data/'
    },
    {
      description: 'refuses a redirect to a private address',
      location: 'https://10.0.0.5/admin'
    },
    {
      description: 'refuses a redirect downgrading to plain http',
      location: 'http://cdn.example/photo.jpg'
    },
    {
      description: 'refuses a redirect to a local-network name',
      location: 'https://metadata.google.internal/x'
    }
  ])('$description', async ({ location }) => {
    fetchMock.mockResolvedValue(redirectTo(location))

    expect(await safeImageFetch('https://cdn.example/photo.jpg')).toBeNull()
    // Only the first hop was ever requested — the target was refused.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('resolves a relative Location against the hop that returned it', async () => {
    fetchMock
      .mockResolvedValueOnce(redirectTo('/moved/real.jpg'))
      .mockResolvedValueOnce(imageResponse())

    const response = await safeImageFetch('https://cdn.example/a/photo.jpg')
    expect(response?.status).toBe(200)
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      'https://cdn.example/moved/real.jpg'
    )
  })

  it('gives up rather than following an unbounded redirect chain', async () => {
    fetchMock.mockResolvedValue(redirectTo('https://cdn.example/next.jpg'))

    expect(await safeImageFetch('https://cdn.example/photo.jpg')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(MAX_SAFE_IMAGE_REDIRECTS + 1)
  })

  it('returns null for a redirect carrying no Location', async () => {
    fetchMock.mockResolvedValue(redirectTo(null))

    expect(await safeImageFetch('https://cdn.example/photo.jpg')).toBeNull()
  })

  it('refuses a plain http URL at the first hop, without fetching', async () => {
    expect(await safeImageFetch('http://cdn.example/photo.jpg')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// Documents the platform behaviour manual mode exists to prevent: a bare
// `fetch` carries the request to the redirect target on its own, so a guard
// that only inspects the URL it was handed inspects the wrong request.
describe('default fetch redirect behaviour', () => {
  const servers: ReturnType<typeof createServer>[] = []

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve())
          })
      )
    )
  })

  const startServer = async (
    handler: Parameters<typeof createServer>[1]
  ): Promise<string> => {
    const server = createServer(handler)
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    return `http://127.0.0.1:${port}`
  }

  it('follows a redirect into the local network when left at its default', async () => {
    const internal = await startServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'image/jpeg' })
      response.end('INTERNAL')
    })
    const origin = await startServer((_request, response) => {
      response.writeHead(302, { location: `${internal}/secret` })
      response.end()
    })

    const followed = await fetch(`${origin}/photo.jpg`)
    expect(await followed.text()).toBe('INTERNAL')

    const manual = await fetch(`${origin}/photo.jpg`, { redirect: 'manual' })
    expect(manual.status).toBe(302)
    expect(manual.headers.get('location')).toBe(`${internal}/secret`)
    await manual.body?.cancel()
  })
})

// Three rounds of review each found this guard's address policy disagreeing
// with `safeRemoteFetch`'s, because it was a hand-rolled second copy. It now
// delegates to the shared one.
//
// Asserting `isRestrictedDownloadAddress(a) === isUnsafeAddress(a)` would be
// `f(x) === f(x)` while that delegation stands — it goes red only if someone
// re-introduces a local implementation, which is a useful tripwire but pins
// nothing about the policy itself. So the answers are written out instead:
// every form either implementation has ever cared about, with the value it
// must produce.
describe('address policy', () => {
  // The only addresses in this table that may be fetched. Everything else is
  // some flavour of local, private, reserved, or a tunnel form carrying one.
  const SAFE_ADDRESSES = [
    '93.184.216.34',
    '1.1.1.1',
    '2606:2800:220::1',
    // Embedded-IPv4 forms whose payload is PUBLIC. Blanket-blocking these
    // prefixes refused every origin on a DNS64/NAT64 deployment.
    '::ffff:93.184.216.34',
    '::93.184.216.34',
    '64:ff9b::5db8:d822'
  ]

  const UNSAFE_ADDRESSES = [
    // IPv4: unspecified, loopback, private, CGNAT, link-local, reserved
    '0.0.0.0',
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '192.0.0.1',
    '192.0.2.1',
    '192.88.99.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '240.0.0.1',
    // IPv6: unspecified, loopback, discard, unique-local, link-local,
    // multicast, documentation
    '::',
    '::1',
    '100::1',
    'fc00::1',
    'fd00::1',
    'fe80::1',
    'ff00::1',
    '2001:db8::1',
    // IPv6 tunnel and translation prefixes
    '2001::1',
    '2001:10::1',
    '2001:20::1',
    '2001:1f::1',
    '2001:2f:ffff::1',
    '2002:7f00:1::',
    // Embedded-IPv4 forms whose payload is PRIVATE
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    '::127.0.0.1',
    '64:ff9b::a9fe:a9fe',
    '64:ff9b:1::a9fe:a9fe',
    '64:ff9b:1:ffff::1',
    // Spellings that must normalise before the policy sees them
    '[::1]',
    '::FFFF:127.0.0.1',
    // Fails closed on anything that is not an address at all
    'not-an-address',
    ''
  ]

  it.each(SAFE_ADDRESSES.map((address) => ({ address })))(
    'allows $address',
    ({ address }) => {
      expect(isRestrictedDownloadAddress(address)).toBe(false)
    }
  )

  it.each(UNSAFE_ADDRESSES.map((address) => ({ address })))(
    'refuses $address',
    ({ address }) => {
      expect(isRestrictedDownloadAddress(address)).toBe(true)
    }
  )

  // The tripwire the parity assertion was reaching for: a re-introduced local
  // copy would answer these the way the old BlockList did, and differ.
  it('answers identically to the shared policy it delegates to', () => {
    for (const address of [...SAFE_ADDRESSES, ...UNSAFE_ADDRESSES]) {
      expect(isRestrictedDownloadAddress(address)).toBe(
        isUnsafeAddress(address)
      )
    }
  })
})
