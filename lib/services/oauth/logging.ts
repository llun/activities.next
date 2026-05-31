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
  'token'
])

// Keys can carry surrounding whitespace (URLSearchParams and JSON both preserve
// it), which would slip a secret past an exact-match redaction check. Normalize
// before comparing so e.g. ` code_verifier ` is still redacted.
const isSensitiveParam = (key: string): boolean =>
  SENSITIVE_PARAMS.has(key.trim().toLowerCase())

// Strips the query string and fragment from a URL-valued header, keeping only
// origin + path for diagnostics. OAuth redirect URLs put `code`/`access_token`
// in exactly those parts, so dropping them avoids persisting secrets. A value
// that is not a parseable absolute URL is redacted entirely to be safe.
const sanitizeUrlValue = (value: string): string => {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return '[REDACTED]'
  }
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

/**
 * Parses a form-urlencoded (or query string) body into a plain object with
 * secret parameters redacted, keeping the rest (grant_type, client_id,
 * redirect_uri, scope, response_type, ...) which is exactly what is needed to
 * understand a 400.
 */
export const sanitizeFormBody = (body: string): Record<string, string> => {
  const result: Record<string, string> = {}
  new URLSearchParams(body).forEach((value, key) => {
    result[key] = isSensitiveParam(key) ? '[REDACTED]' : value
  })
  return result
}

// Recursion is bounded so a deeply nested, attacker-controlled body (the apps
// endpoint logs the raw, parse-failed request) cannot blow the stack and turn a
// 422 into a 500. Beyond this depth the subtree is dropped rather than walked.
const MAX_SANITIZE_DEPTH = 8

/**
 * Redacts secret keys from an already-parsed value (e.g. a JSON body or
 * query-param record). Recurses into nested objects and arrays so a secret key
 * nested under a non-sensitive parent is still redacted — the apps endpoint
 * logs the raw, parse-failed request body, which is attacker-controlled and may
 * be arbitrarily nested. Recursion depth is capped to stay DoS-safe.
 */
export const sanitizeParams = (value: unknown, depth = 0): unknown => {
  if (value && typeof value === 'object') {
    if (depth >= MAX_SANITIZE_DEPTH) return '[TRUNCATED]'
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeParams(item, depth + 1))
    }
    const result: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      result[key] = isSensitiveParam(key)
        ? '[REDACTED]'
        : sanitizeParams(nested, depth + 1)
    }
    return result
  }
  return value
}
