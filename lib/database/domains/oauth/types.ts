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

export interface OAuthDatabase {
  getClientFromId(params: GetClientFromIdParams): Promise<Client | null>
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
