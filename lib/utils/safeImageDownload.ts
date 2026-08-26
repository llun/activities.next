import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

/**
 * Downloading an image from a URL this instance did not choose — a Strava photo
 * URL handed to us by Strava's API, a remote attachment URL a federating actor
 * put on a note.
 *
 * This is deliberately NOT `safeRemoteFetch`. That guard reads the response
 * body as a UTF-8 string (`Buffer.concat(chunks).toString('utf8')`), which
 * mangles image bytes, so a binary download has to run through a plain `fetch`.
 * What is reusable is the URL check and the redirect discipline, and that is
 * what lives here: callers pair `safeImageFetch` with a content-type check and
 * `readResponseArrayBufferWithLimit` for the byte cap.
 *
 * Residual risk, accepted and documented rather than closed: the guard resolves
 * the hostname and `fetch` resolves it again, so a DNS record that flips
 * between the two resolutions wins the race. `safeRemoteFetch` pins the
 * resolved address into its transport; this does not. Closing it would mean a
 * binary-mode entry point on `createSafeRemoteFetch`, which is a larger change
 * than these two callers justify.
 */
const RESTRICTED_ADDRESS_BLOCK_LIST = new BlockList()

RESTRICTED_ADDRESS_BLOCK_LIST.addSubnet('0.0.0.0', 8)
RESTRICTED_ADDRESS_BLOCK_LIST.addSubnet('10.0.0.0', 8)
RESTRICTED_ADDRESS_BLOCK_LIST.addSubnet('100.64.0.0', 10)
RESTRICTED_ADDRESS_BLOCK_LIST.addSubnet('127.0.0.0', 8)
RESTRICTED_ADDRESS_BLOCK_LIST.addSubnet('169.254.0.0', 16)
RESTRICTED_ADDRESS_BLOCK_LIST.addSubnet('172.16.0.0', 12)
RESTRICTED_ADDRESS_BLOCK_LIST.addSubnet('192.0.0.0', 24)
RESTRICTED_ADDRESS_BLOCK_LIST.addSubnet('192.0.2.0', 24)
RESTRICTED_ADDRESS_BLOCK_LIST.addSubnet('192.168.0.0', 16)
RESTRICTED_ADDRESS_BLOCK_LIST.addSubnet('198.18.0.0', 15)
RESTRICTED_ADDRESS_BLOCK_LIST.addSubnet('198.51.100.0', 24)
RESTRICTED_ADDRESS_BLOCK_LIST.addSubnet('203.0.113.0', 24)
RESTRICTED_ADDRESS_BLOCK_LIST.addSubnet('224.0.0.0', 4)
RESTRICTED_ADDRESS_BLOCK_LIST.addSubnet('240.0.0.0', 4)
RESTRICTED_ADDRESS_BLOCK_LIST.addSubnet('::', 128, 'ipv6')
RESTRICTED_ADDRESS_BLOCK_LIST.addSubnet('::1', 128, 'ipv6')
RESTRICTED_ADDRESS_BLOCK_LIST.addSubnet('fc00::', 7, 'ipv6')
RESTRICTED_ADDRESS_BLOCK_LIST.addSubnet('fe80::', 10, 'ipv6')
RESTRICTED_ADDRESS_BLOCK_LIST.addSubnet('ff00::', 8, 'ipv6')
RESTRICTED_ADDRESS_BLOCK_LIST.addSubnet('2001:db8::', 32, 'ipv6')
// Forms that carry an IPv4 destination inside an IPv6 address. `BlockList`
// resolves the IPv4-MAPPED form (`::ffff:a.b.c.d`) against the IPv4 rules
// above on its own, but not these — so without them, stripping the brackets
// off a literal made `https://[64:ff9b::a9fe:a9fe]/` reach 169.254.169.254 on
// any host with a NAT64 gateway. `safeRemoteFetch` rejects every one of these
// explicitly; this is the BlockList spelling of the same list.
RESTRICTED_ADDRESS_BLOCK_LIST.addSubnet('::', 96, 'ipv6') // IPv4-compatible
RESTRICTED_ADDRESS_BLOCK_LIST.addSubnet('64:ff9b::', 96, 'ipv6') // NAT64
RESTRICTED_ADDRESS_BLOCK_LIST.addSubnet('64:ff9b:1::', 48, 'ipv6') // RFC 8215
RESTRICTED_ADDRESS_BLOCK_LIST.addSubnet('2001::', 32, 'ipv6') // Teredo
RESTRICTED_ADDRESS_BLOCK_LIST.addSubnet('2001:10::', 28, 'ipv6') // ORCHID
RESTRICTED_ADDRESS_BLOCK_LIST.addSubnet('2001:20::', 28, 'ipv6') // ORCHIDv2
RESTRICTED_ADDRESS_BLOCK_LIST.addSubnet('2002::', 16, 'ipv6') // 6to4

// Same ceiling `safeRemoteFetch` applies (DEFAULT_SAFE_REMOTE_FETCH_MAX_REDIRECTS).
export const MAX_SAFE_IMAGE_REDIRECTS = 3
export const DEFAULT_SAFE_IMAGE_TIMEOUT_MS = 10_000

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308])

// `new URL(...).hostname` keeps the brackets on an IPv6 literal, and `isIP`
// answers 0 for a bracketed address — which would send every IPv6 literal down
// the DNS branch, where resolving an address rather than a name fails and the
// empty-result check rejects it. That failed closed, but it also meant the
// blocklist never actually evaluated an IPv6 literal, so `[::1]` was refused
// for the wrong reason. `safeRemoteFetch` strips the same way.
const stripIpv6Brackets = (hostname: string) =>
  hostname.replace(/^\[/, '').replace(/\]$/, '')

export const isRestrictedDownloadHostname = (hostname: string) => {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.home.arpa')
  )
}

export const isRestrictedDownloadAddress = (address: string) => {
  const family = isIP(address)
  // `isIP` answers 0 for anything it cannot parse. Fail closed.
  if (family === 0) {
    return true
  }

  return RESTRICTED_ADDRESS_BLOCK_LIST.check(
    address,
    family === 6 ? 'ipv6' : 'ipv4'
  )
}

/**
 * Returns the parsed URL when it is safe to download from, or `null` when it is
 * not — a non-HTTPS scheme, embedded credentials, a hostname that names the
 * local network, or a hostname that resolves to ANY restricted address. Every
 * resolved address is checked, not just the first, so a DNS record mixing a
 * public and a private answer is rejected.
 */
export const getSafeImageDownloadUrl = async (rawUrl: string) => {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }

  if (url.protocol !== 'https:' || url.username || url.password) {
    return null
  }

  const hostname = stripIpv6Brackets(url.hostname.trim().toLowerCase())
  if (!hostname || isRestrictedDownloadHostname(hostname)) {
    return null
  }

  if (isIP(hostname)) {
    return isRestrictedDownloadAddress(hostname) ? null : url
  }

  const resolvedAddresses = await lookup(hostname, {
    all: true,
    verbatim: true
  }).catch(() => [])

  if (
    resolvedAddresses.length === 0 ||
    resolvedAddresses.some(({ address }) =>
      isRestrictedDownloadAddress(address)
    )
  ) {
    return null
  }

  return url
}

/**
 * Fetches a URL this instance did not choose, re-running the guard on EVERY
 * redirect hop.
 *
 * Guarding only the URL a caller hands in guards nothing: `fetch` defaults to
 * `redirect: 'follow'`, so a public host that answers 302 with
 * `Location: http://169.254.169.254/…` sends the request somewhere the guard
 * never saw — and Node applies no mixed-content rule, so an https URL can
 * redirect to plain http on loopback. Hops are therefore taken by hand.
 *
 * Returns the first non-redirect response, or `null` when a hop is refused, a
 * redirect carries no usable `Location`, or the hop budget runs out. The caller
 * still owns the content-type check and the byte cap.
 */
export const safeImageFetch = async (
  rawUrl: string,
  { timeoutMs = DEFAULT_SAFE_IMAGE_TIMEOUT_MS }: { timeoutMs?: number } = {}
): Promise<Response | null> => {
  let target = rawUrl

  for (let hop = 0; hop <= MAX_SAFE_IMAGE_REDIRECTS; hop += 1) {
    const safeUrl = await getSafeImageDownloadUrl(target)
    if (!safeUrl) return null

    const response = await fetch(safeUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!REDIRECT_STATUS_CODES.has(response.status)) return response

    const location = response.headers.get('location')
    await response.body?.cancel().catch(() => undefined)
    if (!location) return null

    try {
      // A `Location` may be relative; resolve it against the hop we just made.
      target = new URL(location, safeUrl).toString()
    } catch {
      return null
    }
  }

  return null
}
