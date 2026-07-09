import { SearchParams } from './types'

// Better Auth 1.6.9 signs serializeAuthorizationQuery(ctx.query).toString()
// before appending sig in @better-auth/oauth-provider/dist/index.mjs. Its
// signParams helper sets exp with Math.floor(Date.now() / 1e3) + codeExpiresIn
// in the same file. Keep both the order and seconds-based exp units in sync
// when upgrading Better Auth or consent signature verification can fail even
// when the query values are unchanged.
const BetterAuthAuthorizationParamOrder = [
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

const BetterAuthAuthorizationParamSet = new Set(
  BetterAuthAuthorizationParamOrder
)

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
  for (const key of BetterAuthAuthorizationParamOrder) {
    const value = values[key]
    if (shouldIncludeOAuthParam(key, value)) oauthQuery.set(key, value)
  }
  // Preserve future/raw caller params after the signature-sensitive keys. The
  // page currently passes parsed SearchParams, but keeping extras here makes
  // the helper safe if a route later forwards raw URLSearchParams-shaped data.
  for (const [key, value] of Object.entries(values)) {
    if (
      shouldIncludeOAuthParam(key, value) &&
      !BetterAuthAuthorizationParamSet.has(key)
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
