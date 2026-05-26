import { SearchParams } from './types'

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

export const buildOAuthQuery = (params: SearchParams): string => {
  const oauthQuery = new URLSearchParams()
  const values = params as Record<string, string | null | undefined>
  for (const key of BetterAuthAuthorizationParamOrder) {
    const value = values[key]
    if (value != null) oauthQuery.set(key, value)
  }
  for (const [key, value] of Object.entries(values)) {
    if (value != null && !BetterAuthAuthorizationParamOrder.includes(key)) {
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
  const url = new URL('/api/auth/oauth2/authorize', baseUrl)
  url.search = buildOAuthQuery(params)
  return url.toString()
}

export const shouldDelegateToBetterAuth = (params: SearchParams): boolean =>
  !params.sig || !params.exp
