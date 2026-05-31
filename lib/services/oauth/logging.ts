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

// Headers that must be redacted entirely. Cookie values are delimited by
// `; ` and can carry a browser session token in any pair, so no part of them
// is safe to log.
const FULLY_REDACTED_HEADERS = new Set(['cookie', 'set-cookie'])

// Headers whose value is a URL that can carry secret query/fragment params
// (e.g. an authorization `code` or `access_token` in an OAuth redirect URL).
// Their query string and fragment are dropped before logging.
const URL_BEARING_HEADERS = new Set(['referer', 'referrer', 'location'])

// Body/query parameter names that carry secrets or PII and must be redacted.
// `username`/`email` are not part of the configured grant types, but redacting
// them keeps PII out of logs if a password/custom grant or the registration
// body ever carries them. `state` is the client's CSRF binding and `assertion`
// carries a JWT/SAML credential in assertion grants.
const SENSITIVE_PARAMS = new Set([
  'client_secret',
  'client_assertion',
  'assertion',
  'code',
  'code_verifier',
  'password',
  'username',
  'email',
  'state',
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

// Strips the query string and fragment from a URL-valued header, keeping only
// origin + path (absolute) or path (relative) for diagnostics. OAuth redirect
// URLs put `code`/`access_token` in exactly those parts, so dropping them avoids
// persisting secrets while keeping the useful routing/redirect target. A value
// that parses to neither an absolute nor a rooted relative URL is redacted
// entirely to be safe.
const sanitizeUrlValue = (value: string): string => {
  try {
    const absolute = new URL(value)
    return `${absolute.origin}${absolute.pathname}`
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

// Redacts a single param value: secret params become [REDACTED], URL-valued
// params keep scheme+host+path but drop query/fragment, everything else passes
// through. Shared by sanitizeFormBody and sanitizeParams.
const sanitizeParamValue = (key: string, value: unknown): unknown => {
  if (isSensitiveParam(key)) return '[REDACTED]'
  if (typeof value === 'string' && isUrlValuedParam(key)) {
    return sanitizeUrlValue(value)
  }
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
 * be arbitrarily nested. Recursion depth is capped to stay DoS-safe, and
 * non-plain objects (Date, RegExp, class instances) are returned as-is rather
 * than being flattened to `{}` by `Object.entries`.
 */
export const sanitizeParams = (value: unknown, depth = 0): unknown => {
  if (value && typeof value === 'object') {
    if (depth >= MAX_SANITIZE_DEPTH) return '[TRUNCATED]'
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeParams(item, depth + 1))
    }
    const proto = Object.getPrototypeOf(value)
    if (proto !== null && proto !== Object.prototype) {
      return value
    }
    const result: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      if (isSensitiveParam(key)) {
        result[key] = '[REDACTED]'
      } else if (typeof nested === 'string' && isUrlValuedParam(key)) {
        result[key] = sanitizeUrlValue(nested)
      } else {
        result[key] = sanitizeParams(nested, depth + 1)
      }
    }
    return result
  }
  return value
}
