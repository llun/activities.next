import { logger } from '@/lib/utils/logger'

/**
 * Child logger scoped to the OAuth flow so production logs can be filtered with
 * the `module` field. Used to debug the 400 responses third-party Mastodon
 * clients hit during sign-in (app registration, the authorize redirect and the
 * token proxy).
 */
export const oauthLogger = logger.child({ module: 'oauth' })

// Authorization headers whose secret is dropped but whose scheme (Basic /
// Bearer / ...) is kept, since clients frequently send the wrong one.
const SCHEME_PRESERVING_HEADERS = new Set([
  'authorization',
  'proxy-authorization'
])

// Headers that must be redacted entirely. Cookie values can carry a browser
// session token. The proxy/CDN IP headers are direct client identifiers (raw
// user IPs); the app-registration path deliberately hashes the same source IP
// for rate limiting, so logging them verbatim here would defeat that
// pseudonymization and persist raw IPs in production logs.
const FULLY_REDACTED_HEADERS = new Set([
  'cookie',
  'set-cookie',
  'cf-connecting-ip',
  'x-real-ip',
  'x-forwarded-for',
  'x-client-ip',
  'true-client-ip'
])

// Headers whose value is a URL that can carry secret query/fragment params
// (e.g. an authorization `code` or `access_token` in an OAuth redirect URL).
// Their query string and fragment are dropped before logging.
const URL_BEARING_HEADERS = new Set(['referer', 'referrer', 'location'])

// Body/query parameter names that carry secrets or PII and must be redacted.
// `username`/`email` are not part of the configured grant types, but redacting
// them keeps PII out of logs if a password/custom grant or the registration
// body ever carries them. `state`/`nonce` are the client's CSRF / OIDC replay
// bindings and `assertion` carries a JWT/SAML credential in assertion grants.
const SENSITIVE_PARAMS = new Set([
  'client_secret',
  'client_assertion',
  'assertion',
  'code',
  'code_verifier',
  'password',
  'password_confirmation',
  'password_confirm',
  'confirm_password',
  'current_password',
  'new_password',
  'otp',
  'totp',
  'mfa_code',
  'mfa_token',
  'username',
  'email',
  'state',
  'nonce',
  'refresh_token',
  'access_token',
  'id_token',
  'id_token_hint',
  'token'
])

// Param names whose value is a URL. Their value is kept (scheme+host+path is the
// usual signal for a redirect_uri-mismatch 400) but their query string and
// fragment are dropped, since a client can append secrets there.
const URL_VALUED_PARAMS = new Set([
  'redirect_uri',
  'redirect_uris',
  'request_uri'
])

const normalizeKey = (key: string): string => key.trim().toLowerCase()

// Keys can carry surrounding whitespace (URLSearchParams and JSON both preserve
// it), which would slip a secret past an exact-match redaction check. Mastodon
// and Rails clients also use bracket notation for nested params (e.g.
// `user[password]`), so the key is split on brackets/whitespace and each
// segment is checked. Normalizing this way redacts ` code_verifier ` and
// `user[password]` alike.
const matchesParamSet = (key: string, set: Set<string>): boolean => {
  const normalized = normalizeKey(key)
  if (set.has(normalized)) return true
  return normalized
    .split(/[[\]\s]+/)
    .filter(Boolean)
    .some((segment) => set.has(segment))
}

const isSensitiveParam = (key: string): boolean =>
  matchesParamSet(key, SENSITIVE_PARAMS)

const isUrlValuedParam = (key: string): boolean =>
  matchesParamSet(key, URL_VALUED_PARAMS)

// Origin used only to parse relative URL-valued headers (e.g. a `/callback?...`
// Referer/Location). It is stripped back off before returning, so it never
// appears in logs.
const RELATIVE_URL_BASE = 'http://relative.invalid'

// Strips the query string and fragment from a URL-valued header/param, keeping
// only origin + path (http/https), scheme + path (custom schemes / URNs), or
// path (relative) for diagnostics. OAuth redirect URLs put `code`/`access_token`
// in exactly those parts, so dropping them avoids persisting secrets while
// keeping the useful routing/redirect target. A value that parses to neither an
// absolute nor a rooted relative URL is redacted entirely to be safe.
const sanitizeUrlValue = (value: string): string => {
  try {
    const absolute = new URL(value)
    // `origin` is the string "null" for non-http(s) schemes (e.g. a mobile
    // deep link `myapp://callback` or a URN), which would log as "null/...".
    // For those, keep the full href minus the secret-bearing query/fragment so
    // a redirect_uri mismatch is still debuggable.
    if (absolute.protocol === 'http:' || absolute.protocol === 'https:') {
      return `${absolute.origin}${absolute.pathname}`
    }
    return absolute.href.split('#')[0].split('?')[0]
  } catch {
    // Not an absolute URL — try it as a path relative to a dummy base.
  }
  if (value.startsWith('/')) {
    try {
      return new URL(value, RELATIVE_URL_BASE).pathname
    } catch {
      return '[REDACTED]'
    }
  }
  return '[REDACTED]'
}

/**
 * Collects request headers into a plain object with credential-bearing values
 * redacted. For `authorization`/`proxy-authorization` we keep the auth scheme
 * (e.g. `Basic`, `Bearer`) since clients frequently send the wrong one, but
 * drop the secret. Cookie headers are redacted in full.
 */
export const sanitizeHeaders = (headers: Headers): Record<string, string> => {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    const normalizedKey = key.toLowerCase()
    if (FULLY_REDACTED_HEADERS.has(normalizedKey)) {
      result[key] = '[REDACTED]'
      return
    }
    if (SCHEME_PRESERVING_HEADERS.has(normalizedKey)) {
      const scheme = value.split(' ')[0]
      result[key] =
        scheme && scheme !== value ? `${scheme} [REDACTED]` : '[REDACTED]'
      return
    }
    if (URL_BEARING_HEADERS.has(normalizedKey)) {
      result[key] = sanitizeUrlValue(value)
      return
    }
    result[key] = value
  })
  return result
}

// String values longer than this are truncated before logging. The 422
// app-registration path logs the raw, unauthenticated request body, so an
// oversized field (e.g. a multi-megabyte client_name) must not be written to
// logs near-verbatim.
const MAX_LOGGED_STRING_LENGTH = 1024

const truncateString = (value: string): string =>
  value.length > MAX_LOGGED_STRING_LENGTH
    ? `${value.slice(0, MAX_LOGGED_STRING_LENGTH)}…[truncated ${value.length - MAX_LOGGED_STRING_LENGTH} chars]`
    : value

// A sanitized URL is still length-capped: a malformed redirect_uri with a
// megabyte-long path can fail schema validation and reach the logger, so it
// must not bypass the amplification guard that ordinary strings get.
const sanitizeUrlValueCapped = (value: string): string =>
  truncateString(sanitizeUrlValue(value))

// Caps on breadth so an oversized rejected body cannot amplify log volume on the
// unauthenticated 422 path: at most this many object keys / array items are kept
// per level, the rest summarized.
const MAX_SANITIZE_ENTRIES = 100

// Maps at most MAX_SANITIZE_ENTRIES items of an array, appending a summary entry
// for the remainder. Shared by every array branch so the breadth cap is applied
// uniformly (including URL-valued arrays like `redirect_uris`).
const boundedMap = (
  items: unknown[],
  mapFn: (item: unknown) => unknown
): unknown[] => {
  const kept = items.slice(0, MAX_SANITIZE_ENTRIES).map(mapFn)
  if (items.length > MAX_SANITIZE_ENTRIES) {
    kept.push(`[truncated ${items.length - MAX_SANITIZE_ENTRIES} items]`)
  }
  return kept
}

// Redacts a single param value: secret params become [REDACTED]; URL-valued
// params keep scheme+host+path but drop query/fragment (including each element
// of an array, e.g. `redirect_uris` — string entries are URL-sanitized, and
// non-string entries are recursed so nested secrets are still redacted); plain
// strings are length-capped; everything else passes through. Shared by
// sanitizeFormBody and sanitizeParams.
const sanitizeParamValue = (
  key: string,
  value: unknown,
  depth = 0
): unknown => {
  if (isSensitiveParam(key)) return '[REDACTED]'
  if (isUrlValuedParam(key)) {
    if (typeof value === 'string') return sanitizeUrlValueCapped(value)
    if (Array.isArray(value)) {
      return boundedMap(value, (item) =>
        typeof item === 'string'
          ? sanitizeUrlValueCapped(item)
          : sanitizeParams(item, depth + 1)
      )
    }
  }
  if (typeof value === 'string') return truncateString(value)
  return value
}

/**
 * Parses a form-urlencoded (or query string) body into a plain object with
 * secret parameters redacted and URL-valued params (redirect_uri, ...) stripped
 * of query/fragment, keeping the rest (grant_type, client_id, scope,
 * response_type, ...) which is exactly what is needed to understand a 400.
 */
export const sanitizeFormBody = (body: string): Record<string, string> => {
  const result: Record<string, string> = {}
  new URLSearchParams(body).forEach((value, key) => {
    result[key] = sanitizeParamValue(key, value) as string
  })
  return result
}

// Recursion is bounded so a deeply nested, attacker-controlled body (the apps
// endpoint logs the raw, parse-failed request) cannot blow the stack and turn a
// 422 into a 500. Beyond this depth the subtree is dropped rather than walked.
const MAX_SANITIZE_DEPTH = 8

/**
 * Redacts secret keys from an already-parsed value (e.g. a JSON body or
 * query-param record). Recurses into arrays and plain objects so a secret key
 * nested under a non-sensitive parent is still redacted — the apps endpoint
 * logs the raw, parse-failed request body, which is attacker-controlled and may
 * be arbitrarily nested. Recursion depth and breadth are capped and long
 * strings truncated to stay DoS / log-amplification safe, and non-plain objects
 * (Date, RegExp, class instances) are returned as-is rather than being flattened
 * to `{}` by `Object.entries`.
 */
export const sanitizeParams = (value: unknown, depth = 0): unknown => {
  if (typeof value === 'string') return truncateString(value)
  if (value && typeof value === 'object') {
    if (depth >= MAX_SANITIZE_DEPTH) return '[TRUNCATED]'
    if (Array.isArray(value)) {
      return boundedMap(value, (item) => sanitizeParams(item, depth + 1))
    }
    const proto = Object.getPrototypeOf(value)
    if (proto !== null && proto !== Object.prototype) {
      return value
    }
    const result: Record<string, unknown> = {}
    const entries = Object.entries(value)
    for (const [key, nested] of entries.slice(0, MAX_SANITIZE_ENTRIES)) {
      if (isSensitiveParam(key)) {
        result[key] = '[REDACTED]'
      } else if (
        isUrlValuedParam(key) &&
        (typeof nested === 'string' || Array.isArray(nested))
      ) {
        result[key] = sanitizeParamValue(key, nested, depth)
      } else {
        result[key] = sanitizeParams(nested, depth + 1)
      }
    }
    if (entries.length > MAX_SANITIZE_ENTRIES) {
      result['…'] = `[truncated ${entries.length - MAX_SANITIZE_ENTRIES} keys]`
    }
    return result
  }
  return value
}
