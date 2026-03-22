import { getBaseURL } from '@/lib/config'
import { UsableScopes } from '@/lib/types/database/operations'

export interface OpenIDConfiguration {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint: string
  jwks_uri: string
  revocation_endpoint: string
  scopes_supported: readonly string[]
  response_types_supported: string[]
  response_modes_supported: string[]
  grant_types_supported: string[]
  subject_types_supported: string[]
  id_token_signing_alg_values_supported: string[]
  token_endpoint_auth_methods_supported: string[]
  claims_supported: string[]
  code_challenge_methods_supported: string[]
}

export const getOpenIDConfiguration = (): OpenIDConfiguration => {
  const baseURL = getBaseURL()
  return {
    issuer: baseURL,
    authorization_endpoint: `${baseURL}/api/auth/oauth2/authorize`,
    token_endpoint: `${baseURL}/oauth/token`,
    userinfo_endpoint: `${baseURL}/api/oauth/userinfo`,
    jwks_uri: `${baseURL}/api/auth/jwks`,
    revocation_endpoint: `${baseURL}/api/oauth/revoke`,
    scopes_supported: UsableScopes,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: [
      'authorization_code',
      'client_credentials',
      'refresh_token'
    ],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    token_endpoint_auth_methods_supported: [
      'client_secret_basic',
      'client_secret_post'
    ],
    claims_supported: [
      'sub',
      'name',
      'preferred_username',
      'picture',
      'profile',
      'email',
      'email_verified'
    ],
    code_challenge_methods_supported: ['S256']
  }
}
