// Parameter and result types of the OAuth domain (clients, access tokens and
// connected apps). lib/types/database/operations.ts re-exports them, so
// existing imports keep working. The scope vocabulary (`Scope`) stays in
// operations.ts.
import { z } from 'zod'

import type { ConnectedApp } from '@/lib/types/domain/connected-app'
import type { Client } from '@/lib/types/oauth2/client'

export const GetClientFromIdParams = z.object({
  clientId: z.string()
})
export type GetClientFromIdParams = z.infer<typeof GetClientFromIdParams>

export type GetAccountConnectedAppsParams = {
  accountId: string
}

export type RevokeAccountConnectedAppParams = {
  accountId: string
  clientId: string
  // The actor (consent referenceId) the grant belongs to. Null revokes the
  // account-scoped grant that has no actor reference.
  actorId: string | null
}

export type ExtendOAuthAccessTokenParams = {
  // SHA-256 base64url hash of the bearer token, the same value OAuthGuard looks
  // it up by.
  hashedToken: string
  // Epoch milliseconds.
  expiresAt: number
}

export type CreateOAuthAccessTokenParams = {
  // SHA-256 base64url hash of the issued bearer token, matching how
  // OAuthGuard looks tokens up.
  // Callers MUST pass the hash, never the raw token, so the raw token never
  // touches the database.
  hashedToken: string
  clientId: string
  // The owning account id (stored in `userId`).
  accountId: string
  // The actor delegated by the token (stored in `referenceId`); OAuthGuard
  // resolves the request actor from this column.
  actorId: string
  scopes: string[]
  // Epoch milliseconds.
  expiresAt: number
}

export type GetOAuthAccessTokenByHashParams = {
  // SHA-256 base64url hash of the bearer token (`oauthAccessToken.token`).
  hashedToken: string
}

// The columns of an `oauthAccessToken` row that OAuthGuard reads to accept or
// refuse a bearer token.
export type OAuthAccessTokenRecord = {
  clientId: string
  // The owning account; null for an app (client_credentials) token.
  userId: string | null
  // The actor the token delegates; null or '' when the grant recorded none.
  referenceId: string | null
  // A JSON array or a space-separated scope string, as better-auth stored it.
  scopes: string
  // Epoch milliseconds, on both backends.
  expiresAt: number
}

export type IsOAuthClientPKCERequiredParams = {
  clientId: string
}

export type CountRecentAppRegistrationsParams = {
  // `app-registration:<source key>`, the `oauthClient.referenceId` every
  // registration from that source carries.
  registrationReference: string
  // Counts registrations created at or after this instant (epoch milliseconds).
  since: number
}

export type CreateOAuthClientRegistrationParams = {
  id: string
  clientId: string
  // The hashed secret, never the plain one.
  clientSecret: string
  name: string
  scopes: string[]
  // The `client_credentials` ceiling better-auth requires before it issues an
  // application an app-level token.
  clientCredentialsScopes: string[]
  redirectUris: string[]
  // Null leaves the column empty; end-session stays disabled for that client.
  postLogoutRedirectUris: string[] | null
  enableEndSession: boolean
  website: string | null
  requirePKCE: boolean
  disabled: boolean
  grantTypes: string[]
  responseTypes: string[]
  tokenEndpointAuthMethod: string
  referenceId: string
  // Already a JSON object string; stored as given.
  metadata: string
  // Epoch milliseconds; `createdAt` and `updatedAt` are both set to it.
  createdAt: number
}

export interface OAuthDatabase {
  getClientFromId(params: GetClientFromIdParams): Promise<Client | null>
  // The access token stored under this hash, or null when none is (a revoked
  // or unknown token). Reads the row OAuthGuard authenticates a bearer
  // request from; the expiry is epoch milliseconds on both backends.
  getOAuthAccessTokenByHash(
    params: GetOAuthAccessTokenByHashParams
  ): Promise<OAuthAccessTokenRecord | null>
  // Whether the registered client requires PKCE. False for an unknown client.
  isOAuthClientPKCERequired(
    params: IsOAuthClientPKCERequiredParams
  ): Promise<boolean>
  // How many applications one registration source registered since `since`.
  countRecentAppRegistrations(
    params: CountRecentAppRegistrationsParams
  ): Promise<number>
  // Insert the client row for an application registered through
  // POST /api/v1/apps.
  createOAuthClientRegistration(
    params: CreateOAuthClientRegistrationParams
  ): Promise<void>
  createOAuthAccessToken(params: CreateOAuthAccessTokenParams): Promise<void>
  // Move an access token's expiry to `expiresAt`. OAuthGuard calls it to slide a
  // token that is still in use; see OAUTH_ACCESS_TOKEN_EXPIRES_IN_SECONDS.
  extendOAuthAccessToken(params: ExtendOAuthAccessTokenParams): Promise<void>
  // List the third-party OAuth grants (API clients + SSO sign-ins) the account
  // has authorized, newest first.
  getAccountConnectedApps(
    params: GetAccountConnectedAppsParams
  ): Promise<ConnectedApp[]>
  // Revoke a connected app for the account: deletes the consent and every
  // access/refresh token issued for that client + actor.
  revokeAccountConnectedApp(
    params: RevokeAccountConnectedAppParams
  ): Promise<void>
}
