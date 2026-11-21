import type { SecurityHeader } from './static'

// One year. Deliberately no `includeSubDomains` and no `preload`: this app is
// served on domains whose other subdomains it does not control, so pinning the
// parent domain would break unrelated services on the same registrable domain.
export const STRICT_TRANSPORT_SECURITY_MAX_AGE_SECONDS = 31536000

export const STRICT_TRANSPORT_SECURITY_HEADER: SecurityHeader = {
  key: 'Strict-Transport-Security',
  value: `max-age=${STRICT_TRANSPORT_SECURITY_MAX_AGE_SECONDS}`
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

const isLocalHostname = (hostname: string): boolean =>
  LOCAL_HOSTNAMES.has(hostname.toLowerCase())

type StrictTransportSecurityRequest = {
  nextUrl: { protocol: string; hostname: string }
}

/**
 * The HSTS header for a request, or null when the response must not carry it.
 *
 * Next builds the middleware request URL from `x-forwarded-proto` (falling back
 * to the socket's TLS state), so `nextUrl.protocol` is the app's existing
 * "is this request HTTPS?" answer: it is `https:` both for a direct TLS
 * connection and for a trusted proxy that forwarded `proto=https`. A plain
 * HTTP request gets no header — browsers ignore HSTS over a non-secure
 * transport anyway — and neither does a local host, so a developer running the
 * app over HTTPS on localhost does not pin every other local project.
 */
export const getStrictTransportSecurityHeader = (
  request: StrictTransportSecurityRequest
): SecurityHeader | null => {
  if (request.nextUrl.protocol !== 'https:') return null
  if (isLocalHostname(request.nextUrl.hostname)) return null

  return STRICT_TRANSPORT_SECURITY_HEADER
}
