import { isValidIP, normalizeIP } from '@better-auth/core/utils/ip'
import { NextRequest } from 'next/server'

import {
  getTrustProxyIpHeaderConfig,
  getTrustProxyIpHeadersConfig
} from '@/lib/config/trustProxyIpHeaders'

// `x-forwarded-for` is a list. Pinned (`ACTIVITIES_TRUST_PROXY_IP_HEADER`),
// its right-most entry is read: the one the single trusted proxy appended,
// which the client cannot choose. The unpinned compatibility chain keeps its
// documented left-most reading. Every other header is one value.
const readClientIpHeader = (
  req: NextRequest | Request,
  name: string,
  pinned: boolean
): string | undefined => {
  const value = req.headers.get(name)
  if (!value) return undefined
  if (name !== 'x-forwarded-for') return value.trim() || undefined
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  return pinned ? entries.at(-1) : entries[0]
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
  if (pinnedHeader) return readClientIpHeader(req, pinnedHeader, true)

  return (
    readClientIpHeader(req, 'cf-connecting-ip', false) ??
    readClientIpHeader(req, 'x-real-ip', false) ??
    readClientIpHeader(req, 'x-forwarded-for', false)
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
