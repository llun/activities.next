import { isValidIP, normalizeIP } from '@better-auth/core/utils/ip'
import { NextRequest } from 'next/server'

import {
  getTrustProxyIpHeaderConfig,
  getTrustProxyIpHeadersConfig
} from '@/lib/config/trustProxyIpHeaders'

// `x-forwarded-for` yields its leftmost entry (the original client behind a
// proxy that overwrites the header); every other header is read as one value.
const readClientIpHeader = (
  req: NextRequest | Request,
  name: string
): string | undefined => {
  const value = req.headers.get(name)
  if (!value) return undefined
  const ip =
    name === 'x-forwarded-for'
      ? value
          .split(',')
          .map((entry) => entry.trim())
          .find(Boolean)
      : value.trim()
  return ip || undefined
}

/**
 * The client's address from the proxy headers, but only when the operator has
 * said those headers are set by a proxy they trust
 * (`ACTIVITIES_TRUST_PROXY_IP_HEADERS`). Client IP headers are deployment
 * specific and spoofable otherwise, so without the opt-in there is no address
 * and a caller must not key a limit on one. With
 * `ACTIVITIES_TRUST_PROXY_IP_HEADER` set only that header is read, so a header
 * the proxy does not overwrite cannot be supplied by the client; unset, the
 * compatibility chain cf-connecting-ip, x-real-ip, x-forwarded-for applies.
 */
export const getTrustedClientIp = (
  req: NextRequest | Request
): string | undefined => {
  if (!getTrustProxyIpHeadersConfig()) return undefined

  const pinnedHeader = getTrustProxyIpHeaderConfig()
  if (pinnedHeader) return readClientIpHeader(req, pinnedHeader)

  return (
    readClientIpHeader(req, 'cf-connecting-ip') ??
    readClientIpHeader(req, 'x-real-ip') ??
    readClientIpHeader(req, 'x-forwarded-for')
  )
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
