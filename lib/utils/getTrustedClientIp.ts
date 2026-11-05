import { isValidIP, normalizeIP } from '@better-auth/core/utils/ip'
import { NextRequest } from 'next/server'

import { getTrustProxyIpHeadersConfig } from '@/lib/config/trustProxyIpHeaders'

/**
 * The client's address from the proxy headers, but only when the operator has
 * said those headers are set by a proxy they trust
 * (`ACTIVITIES_TRUST_PROXY_IP_HEADERS`). Client IP headers are deployment
 * specific and spoofable otherwise, so without the opt-in there is no address
 * and a caller must not key a limit on one.
 */
export const getTrustedClientIp = (
  req: NextRequest | Request
): string | undefined => {
  if (!getTrustProxyIpHeadersConfig()) return undefined

  const cfConnectingIp = req.headers.get('cf-connecting-ip')?.trim()
  if (cfConnectingIp) return cfConnectingIp

  const realIp = req.headers.get('x-real-ip')?.trim()
  if (realIp) return realIp

  const forwardedFor = req.headers
    .get('x-forwarded-for')
    ?.split(',')
    .map((ip) => ip.trim())
    .find(Boolean)
  if (forwardedFor) return forwardedFor

  return undefined
}

/**
 * Canonical per-client rate-limit key derived from `getTrustedClientIp`:
 * validates the address, unwraps IPv4-mapped IPv6 (`::ffff:x.x.x.x`), and
 * collapses IPv6 hosts into their `/64` subnet so rotating interface IDs on a
 * single residential `/64` share one bucket.
 */
export const getTrustedClientRateLimitKey = (
  req: NextRequest | Request
): string | undefined => {
  const ip = getTrustedClientIp(req)
  if (!ip || !isValidIP(ip)) return undefined
  return normalizeIP(ip, { ipv6Subnet: 64 })
}
