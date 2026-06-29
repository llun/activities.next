import { getBaseURL } from '@/lib/config'
import { UsableScopes } from '@/lib/types/database/operations'

export interface OAuthAuthorizationServerMetadata {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  revocation_endpoint: string
  userinfo_endpoint: string
  jwks_uri: string
  scopes_supported: readonly string[]
  response_types_supported: string[]
  response_modes_supported: string[]
  grant_types_supported: string[]
  token_endpoint_auth_methods_supported: string[]
  code_challenge_methods_supported: string[]
  service_documentation: string
  app_registration_endpoint: string
}

// `baseURL` defaults to the configured host but callers serving a request
// SHOULD pass the validated per-request origin (`resolveAuthBaseURL`) so a
// client discovering this metadata on a trusted alias/served domain is pointed
// at that same domain — better-auth resolves its baseURL per request the same
// way, so the advertised endpoints match where the flow actually runs. Falling
// back to the configured host keeps non-request callers and existing tests working.
export const getOAuthAuthorizationServerMetadata = (
  baseURL: string = getBaseURL()
): OAuthAuthorizationServerMetadata => {
  return {
    issuer: baseURL,
    authorization_endpoint: `${baseURL}/api/auth/oauth2/authorize`,
    token_endpoint: `${baseURL}/oauth/token`,
    revocation_endpoint: `${baseURL}/oauth/revoke`,
    userinfo_endpoint: `${baseURL}/oauth/userinfo`,
    jwks_uri: `${baseURL}/api/auth/jwks`,
    scopes_supported: UsableScopes,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: [
      'authorization_code',
      'client_credentials',
      'refresh_token'
    ],
    token_endpoint_auth_methods_supported: [
      'client_secret_basic',
      'client_secret_post'
    ],
    code_challenge_methods_supported: ['S256'],
    service_documentation: 'https://github.com/llun/activities.next',
    app_registration_endpoint: `${baseURL}/api/v1/apps`
  }
}
