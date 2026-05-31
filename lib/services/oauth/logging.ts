import { logger } from '@/lib/utils/logger'

/**
 * Child logger scoped to the OAuth flow so production logs can be filtered with
 * the `module` field. Used to debug the 400 responses third-party Mastodon
 * clients hit during sign-in (app registration, the authorize redirect and the
 * token proxy).
 */
export const oauthLogger = logger.child({ module: 'oauth' })

// Header names whose values carry credentials and must never be logged in full.
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie'
])

// Body/query parameter names that carry secrets and must be redacted.
const SENSITIVE_PARAMS = new Set([
  'client_secret',
  'client_assertion',
  'code',
  'code_verifier',
  'password',
  'refresh_token',
  'access_token',
  'token'
])

// Keys can carry surrounding whitespace (URLSearchParams and JSON both preserve
// it), which would slip a secret past an exact-match redaction check. Normalize
// before comparing so e.g. ` code_verifier ` is still redacted.
const isSensitiveParam = (key: string): boolean =>
  SENSITIVE_PARAMS.has(key.trim().toLowerCase())

/**
 * Collects request headers into a plain object with credential-bearing values
 * redacted. For `authorization` we keep the auth scheme (e.g. `Basic`,
 * `Bearer`) since clients frequently send the wrong one, but drop the secret.
 */
export const sanitizeHeaders = (headers: Headers): Record<string, string> => {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
      const scheme = value.split(' ')[0]
      result[key] =
        scheme && scheme !== value ? `${scheme} [REDACTED]` : '[REDACTED]'
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

/**
 * Redacts secret keys from an already-parsed params object (e.g. a JSON body or
 * query-param record).
 */
export const sanitizeParams = (
  params: Record<string, unknown>
): Record<string, unknown> => {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    result[key] = isSensitiveParam(key) ? '[REDACTED]' : value
  }
  return result
}
