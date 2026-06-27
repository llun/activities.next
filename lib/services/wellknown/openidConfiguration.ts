import { getBaseURL } from '@/lib/config'
import { AUTH_BASE_PATH } from '@/lib/services/auth/constants'
import { UsableScopes } from '@/lib/types/database/operations'

export interface OpenIDConfiguration {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint: string
  jwks_uri: string
  revocation_endpoint: string
  end_session_endpoint: string
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
    // Better Auth signs id_tokens with `iss = baseURL + basePath`, so the
    // discovery `issuer` MUST match that value — a strict OIDC relying party
    // rejects an id_token whose `iss` differs from the issuer it discovered here.
    // `AUTH_BASE_PATH` is the SAME constant `auth.ts` passes to better-auth as
    // `basePath`, so the advertised issuer can never drift from the basePath the
    // tokens are actually signed with. The RFC 8414 OAuth metadata
    // (oauthAuthorizationServer.ts) intentionally keeps the bare origin for
    // Mastodon compatibility; OAuth2 access tokens carry no `iss` to reconcile.
    issuer: `${baseURL}${AUTH_BASE_PATH}`,
    authorization_endpoint: `${baseURL}${AUTH_BASE_PATH}/oauth2/authorize`,
    token_endpoint: `${baseURL}/oauth/token`,
    userinfo_endpoint: `${baseURL}/oauth/userinfo`,
    jwks_uri: `${baseURL}${AUTH_BASE_PATH}/jwks`,
    revocation_endpoint: `${baseURL}/oauth/revoke`,
    // OpenID Connect RP-Initiated Logout 1.0 endpoint, served by the
    // @better-auth/oauth-provider plugin under the auth basePath. A
    // discovery-based relying party (e.g. django-lasuite/mozilla-django-oidc)
    // reads this to perform single logout. The plugin verifies the supplied
    // `id_token_hint` and enforces `id_token.iss === jwt.issuer ?? baseURL`,
    // where its `baseURL` is `${baseURL}${AUTH_BASE_PATH}` — exactly the `issuer`
    // advertised above and stamped on every id_token, so the issuer check is
    // satisfied by construction for tokens this instance issues.
    end_session_endpoint: `${baseURL}${AUTH_BASE_PATH}/oauth2/end-session`,
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
