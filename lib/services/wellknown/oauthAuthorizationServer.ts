import { getConfig } from '@/lib/config'
import { UsableScopes } from '@/lib/database/types/oauth'

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
    const config = getConfig()
    return {
      issuer: `https://${config.host}/`,
      authorization_endpoint: `https://${config.host}/oauth/authorize`,
      token_endpoint: `https://${config.host}/oauth/token`,
      revocation_endpoint: `https://${config.host}/oauth/revoke`,
      scopes_supported: UsableScopes,
      response_types_supported: ['code'],
      response_modes_supported: ['query', 'fragment', 'form_post'],
      grant_types_supported: [
        'authorization_code',
        'password',
        'client_credentials'
      ],
      token_endpoint_auth_methods_supported: [
        'client_secret_basic',
        'client_secret_post'
      ],
      code_challenge_methods_supported: ['S256'],
      service_documentation: 'https://github.com/llun/activities.next',
      app_registration_endpoint: `https://${config.host}/api/v1/apps`
    }
  }
