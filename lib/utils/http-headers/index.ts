/**
 * Outbound HTTP header utilities.
 *
 * Three non-overlapping layers apply headers to responses:
 *
 * 1. Next.js headers() in next.config.ts — applies the four static security
 *    headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy,
 *    Permissions-Policy) to every response via source: '/:path*'.
 *
 * 2. Middleware (proxy.ts) — adds Content-Security-Policy per-request so
 *    runtime config (storage hostnames, Mapbox token) is reflected. Uses an
 *    idempotent guard: does not set the header if already present.
 *
 * 3. Route handlers (lib/utils/response.ts apiResponse / defaultOptions) —
 *    adds the four Access-Control-* CORS headers per-request, derived from
 *    the incoming Origin / Host header.
 *
 * The header keys across these three layers are disjoint. Do not add a header
 * to more than one layer — doing so would cause the response to carry
 * duplicate header values.
 */

// CORS (per-request, route-handler layer)
export { HttpMethod, getCORSHeaders } from './cors'

// Static security headers (build-time, next.config layer)
export { type SecurityHeader, getStaticSecurityHeaders } from './static'

// Content Security Policy (per-request, middleware layer)
export {
  getContentSecurityPolicy,
  getContentSecurityPolicyHeader,
  getSecurityHeaders,
  resetContentSecurityPolicyCacheForTests
} from './csp'
