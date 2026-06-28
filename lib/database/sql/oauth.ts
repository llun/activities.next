import crypto from 'crypto'
import { Knex } from 'knex'

import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  CreateOAuthAccessTokenParams,
  GetAccountConnectedAppsParams,
  GetClientFromAccessTokenParams,
  GetClientFromIdParams,
  GetClientFromNameParams,
  OAuthDatabase,
  RevokeAccountConnectedAppParams
} from '@/lib/types/database/operations'
import { ConnectedApp } from '@/lib/types/domain/connected-app'
import { Client } from '@/lib/types/oauth2/client'

// OAuth scope columns are stored inconsistently across tables: oauthClient.scopes
// is a JSON array, while the better-auth token/consent rows can hold either a
// JSON array or a space/comma-separated OAuth scope string. Normalise all three
// shapes into a string[] so an unexpected scope is surfaced, not dropped.
const parseScopeList = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw !== 'string') return []
  const trimmed = raw.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed.map(String)
    } catch {
      // fall through to delimiter splitting
    }
  }
  return trimmed.split(/[\s,]+/).filter(Boolean)
}

const parseClientRow = (row: Record<string, unknown>): Client => {
  return Client.parse({
    id: row.id,
    clientId: row.clientId,
    clientSecret: row.clientSecret ?? null,
    name: row.name ?? null,
    scopes: getCompatibleJSON(row.scopes as string),
    redirectUris: getCompatibleJSON(row.redirectUris as string),
    website: row.uri ?? null,
    requirePKCE: Boolean(row.requirePKCE ?? false),
    disabled: Boolean(row.disabled ?? false),
    updatedAt: getCompatibleTime(row.updatedAt as string | number | Date),
    createdAt: getCompatibleTime(row.createdAt as string | number | Date)
  })
}

export const OAuthSQLDatabaseMixin = (database: Knex): OAuthDatabase => ({
  async getClientFromName({ name }: GetClientFromNameParams) {
    const row = await database('oauthClient').where('name', name).first()
    if (!row) return null
    return parseClientRow(row)
  },

  async getClientFromId({ clientId }: GetClientFromIdParams) {
    const row = await database('oauthClient')
      .where('clientId', clientId)
      .first()
    if (!row) return null
    return parseClientRow(row)
  },

  async getClientFromAccessToken({
    hashedToken
  }: GetClientFromAccessTokenParams) {
    const row = await database('oauthAccessToken')
      .join('oauthClient', 'oauthClient.clientId', 'oauthAccessToken.clientId')
      .where('oauthAccessToken.token', hashedToken)
      .first('oauthClient.*')
    if (!row) return null
    return parseClientRow(row)
  },

  async createOAuthAccessToken({
    hashedToken,
    clientId,
    accountId,
    actorId,
    scopes,
    expiresAt
  }: CreateOAuthAccessTokenParams) {
    // Mirrors the columns better-auth populates for an issued access token:
    // the `token` column holds the SHA-256 hash (the caller hashes it), `userId`
    // the owning account, and `referenceId` the delegated actor that OAuthGuard
    // resolves the request actor from. Scopes are stored as a JSON array to
    // match the existing oauthClient/oauthAccessToken rows.
    await database('oauthAccessToken').insert({
      id: crypto.randomUUID(),
      token: hashedToken,
      clientId,
      userId: accountId,
      referenceId: actorId,
      scopes: JSON.stringify(scopes),
      expiresAt: new Date(expiresAt),
      createdAt: new Date()
    })
  },

  async getAccountConnectedApps({
    accountId
  }: GetAccountConnectedAppsParams): Promise<ConnectedApp[]> {
    // Each consent row is one "you authorized this app" grant for a (client,
    // actor) pair. Join the registered client for its display name/website.
    // Left join so a grant still lists even if the client metadata is missing.
    const rows = await database('oauthConsent')
      .leftJoin('oauthClient', 'oauthClient.clientId', 'oauthConsent.clientId')
      .where('oauthConsent.userId', accountId)
      .select(
        'oauthConsent.clientId as clientId',
        'oauthConsent.referenceId as actorId',
        'oauthConsent.scopes as scopes',
        'oauthConsent.createdAt as authorizedAt',
        'oauthClient.name as name',
        'oauthClient.uri as website'
      )

    return rows
      .map((row) => {
        const scopes = parseScopeList(row.scopes)
        return ConnectedApp.parse({
          clientId: row.clientId,
          // Normalize an empty-string referenceId to null (matching OAuthGuard's
          // `|| null`) so a no-actor grant lists and revokes consistently — a
          // revoke for it sends no actorId and matches on `whereNull`.
          actorId: row.actorId || null,
          name: row.name ?? null,
          website: row.website ?? null,
          scopes,
          authorizedAt: getCompatibleTime(
            row.authorizedAt as string | number | Date
          ),
          // OpenID Connect grants are sign-in (SSO) connections; everything else
          // is an API client.
          signIn: scopes.includes('openid')
        })
      })
      .sort((a, b) => b.authorizedAt - a.authorizedAt)
  },

  async revokeAccountConnectedApp({
    accountId,
    clientId,
    actorId
  }: RevokeAccountConnectedAppParams): Promise<void> {
    // Scope every delete to the owning account so one account can never revoke
    // another's grant, and to the specific actor so revoking one actor's grant
    // leaves the same app authorized under the account's other actors.
    const scopeToActor = <T extends Knex.QueryBuilder>(query: T): T => {
      // A no-actor grant may be persisted as NULL or as an empty string, and the
      // read path normalizes both to null — so revoke must match both to stay in
      // sync. A concrete actorId matches exactly.
      if (actorId === null) {
        query.where((builder) =>
          builder.whereNull('referenceId').orWhere('referenceId', '')
        )
      } else {
        query.where('referenceId', actorId)
      }
      return query
    }

    // Run the three deletes in one transaction so a partial failure can't leave
    // a half-revoked grant — e.g. tokens gone but a live refresh token still
    // able to mint new access tokens, or a lingering consent row.
    await database.transaction(async (trx) => {
      // Delete access tokens before refresh tokens: oauthAccessToken.refreshId
      // is a FK into oauthRefreshToken, so the children must go first.
      await scopeToActor(
        trx('oauthAccessToken')
          .where('clientId', clientId)
          .andWhere('userId', accountId)
      ).delete()
      await scopeToActor(
        trx('oauthRefreshToken')
          .where('clientId', clientId)
          .andWhere('userId', accountId)
      ).delete()
      await scopeToActor(
        trx('oauthConsent')
          .where('clientId', clientId)
          .andWhere('userId', accountId)
      ).delete()
    })
  }
})
