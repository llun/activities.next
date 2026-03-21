import { getBaseURL } from '@/lib/config'
import { UsableScopes } from '@/lib/types/database/operations'

export interface OAuthAuthorizationServerMetadata {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  revocation_endpoint: string
  scopes_supported: readonly string[]
  response_types_supported: string[]
  response_modes_supported: string[]
  grant_types_supported: string[]
  token_endpoint_auth_methods_supported: string[]
  code_challenge_methods_supported: string[]
  service_documentation: string
  app_registration_endpoint: string
}

export const getOAuthAuthorizationServerMetadata =
  (): OAuthAuthorizationServerMetadata => {
    const baseURL = getBaseURL()
    return {
      issuer: baseURL,
      authorization_endpoint: `${baseURL}/api/auth/oauth2/authorize`,
      token_endpoint: `${baseURL}/oauth/token`,
      revocation_endpoint: `${baseURL}/api/oauth/revoke`,
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
