import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

/**
 * SSRF guard for downloading an image from a URL this instance did not choose —
 * a Strava photo URL handed to us by Strava's API, a remote attachment URL a
 * federating actor put on a note.
 *
 * This is deliberately NOT `safeRemoteFetch`. That guard reads the response
 * body as a UTF-8 string (`Buffer.concat(chunks).toString('utf8')`), which
 * mangles image bytes, so a binary download has to run through a plain `fetch`.
 * What is reusable is the URL check, and that is what lives here: callers pair
 * it with a content-type allowlist and `readResponseArrayBufferWithLimit` for
 * the byte cap.
 *
 * The check re-resolves the hostname and then fetches by hostname, so it is
 * TOCTOU-susceptible in a way `safeRemoteFetch` (which pins the resolved
 * address into the transport) is not. It raises the bar on stored-data SSRF
 * rather than closing it completely.
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

  const hostname = url.hostname.trim().toLowerCase()
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
