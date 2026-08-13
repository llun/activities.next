import { SearchParams } from './types'

// A stable, readable serialization order. NOT a signature-relevant one.
//
// @better-auth/oauth-provider (a direct dependency) signs its consent query in
// `signParams`: it appends `exp`, an issued-at `ba_iat`, and one repeated
// `ba_param` entry per signed parameter name, then hashes
// `canonicalizeOAuthQueryParams(params).toString()` — which SORTS the entries
// by key, then value, before hashing. Verification re-canonicalizes the same
// way, so the order a query is serialized in cannot change the signature.
//
// Nothing here reproduces a signed query anyway. `SearchParams` (types.ts) is a
// plain `z.object`, so it strips the `ba_*` envelope Better Auth signed over,
// and every caller either drops `sig`/`exp` outright
// (`buildBetterAuthAuthorizeUrl`, and `resolveSignInRedirect`, which drops
// `ba_*` too) or — in `AuthorizeCard` — prefers `window.location.search`, the
// raw signed query Better Auth actually put in the address bar, falling back
// here only when there is no window.
//
// So this array does one thing: it fixes the order the known params come out
// in — the request params as RFC 6749 §4.1.1 lists them, signature envelope
// last — with anything unlisted appended after. It filters nothing; the second
// loop in `buildOAuthQuery` passes unknown params through.
const OAuthQueryParamOrder = [
  'response_type',
  'client_id',
  'redirect_uri',
  'scope',
  'state',
  'request_uri',
  'code_challenge',
  'code_challenge_method',
  'nonce',
  'prompt',
  'exp',
  'sig'
]

const OrderedOAuthQueryParams = new Set(OAuthQueryParamOrder)

const shouldIncludeOAuthParam = (
  key: string,
  value: string | null | undefined
): value is string =>
  value != null && (value !== '' || (key !== 'sig' && key !== 'exp'))

export const buildOAuthQuery = (params: SearchParams): string => {
  const oauthQuery = new URLSearchParams()
  // SearchParams carries non-string members (e.g. the coerced `force_login`
  // boolean); the page strips those before building any query, so treat the
  // input as the string record this helper actually forwards. The `unknown`
  // bridge is required because `boolean` no longer overlaps the string record.
  const values = params as unknown as Record<string, string | null | undefined>
  for (const key of OAuthQueryParamOrder) {
    const value = values[key]
    if (shouldIncludeOAuthParam(key, value)) oauthQuery.set(key, value)
  }
  // Preserve future/raw caller params after the ordered keys. The page
  // currently passes parsed SearchParams, but keeping extras here makes the
  // helper safe if a route later forwards raw URLSearchParams-shaped data.
  for (const [key, value] of Object.entries(values)) {
    if (
      shouldIncludeOAuthParam(key, value) &&
      !OrderedOAuthQueryParams.has(key)
    ) {
      oauthQuery.set(key, value)
    }
  }
  return oauthQuery.toString()
}

export const buildOAuthAuthorizePath = (params: SearchParams): string =>
  `/oauth/authorize?${buildOAuthQuery(params)}`

export const buildBetterAuthAuthorizeUrl = (
  params: SearchParams,
  baseUrl: string
): string => {
  const authorizeParams = shouldDelegateToBetterAuth(params)
    ? { ...params, sig: undefined, exp: undefined }
    : params
  const url = new URL('/api/auth/oauth2/authorize', baseUrl)
  url.search = buildOAuthQuery(authorizeParams)
  return url.toString()
}

// `exp` is epoch SECONDS — Better Auth's signParams sets it to
// `Math.floor(Date.now() / 1e3) + codeExpiresIn`. Keep the units in sync when
// upgrading @better-auth/oauth-provider: read them as milliseconds and every
// signature looks live forever, so an expired one reaches the consent POST and
// comes back `invalid_signature`; read milliseconds as seconds and every live
// signature looks long expired, re-delegating to Better Auth on every load.
const hasExpiredBetterAuthSignature = (exp: string): boolean => {
  const expiresAt = Number(exp)
  return !Number.isFinite(expiresAt) || Date.now() / 1000 > expiresAt
}

// Better Auth consent signatures require sig and exp as an inseparable pair. If
// either field is absent, blank, or expired, treat the request as unsigned and
// send it through Better Auth so it can validate the client request and sign a
// fresh consent query.
export const shouldDelegateToBetterAuth = (params: SearchParams): boolean => {
  if (!params.sig || !params.exp) return true
  return hasExpiredBetterAuthSignature(params.exp)
}
