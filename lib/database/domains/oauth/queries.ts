import crypto from 'crypto'
import type { ExpressionBuilder } from 'kysely'
import { sql } from 'kysely'

import type {
  CountRecentAppRegistrationsParams,
  CreateOAuthAccessTokenParams,
  CreateOAuthClientRegistrationParams,
  ExtendOAuthAccessTokenParams,
  GetAccountConnectedAppsParams,
  GetClientFromIdParams,
  GetOAuthAccessTokenByHashParams,
  IsOAuthClientPKCERequiredParams,
  OAuthAccessTokenRecord,
  RevokeAccountConnectedAppParams
} from '@/lib/database/domains/oauth/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import type { DB } from '@/lib/database/kysely/db'
import { timestampValue } from '@/lib/database/kysely/dialect'
import { getCompatibleJSON } from '@/lib/database/utils/getCompatibleJSON'
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

export const getClientFromId = async (
  db: Db,
  { clientId }: GetClientFromIdParams
): Promise<Client | null> => {
  const row = await db
    .selectFrom('oauthClient')
    .selectAll()
    .where('clientId', '=', clientId)
    .limit(1)
    .executeTakeFirst()
  if (!row) return null

  return Client.parse({
    id: row.id,
    clientId: row.clientId,
    clientSecret: row.clientSecret ?? null,
    name: row.name ?? null,
    // `scopes` and `redirectUris` are text columns holding a JSON array, so
    // the driver returns them as strings.
    scopes: getCompatibleJSON(row.scopes as string),
    redirectUris: getCompatibleJSON(row.redirectUris),
    website: row.uri ?? null,
    requirePKCE: row.requirePKCE ?? false,
    disabled: row.disabled ?? false,
    updatedAt: row.updatedAt ?? 0,
    createdAt: row.createdAt ?? 0
  })
}

export const getOAuthAccessTokenByHash = async (
  db: Db,
  { hashedToken }: GetOAuthAccessTokenByHashParams
): Promise<OAuthAccessTokenRecord | null> => {
  const row = await db
    .selectFrom('oauthAccessToken')
    .select(['clientId', 'userId', 'referenceId', 'scopes', 'expiresAt'])
    .where('token', '=', hashedToken)
    .limit(1)
    .executeTakeFirst()
  return row ?? null
}

export const isOAuthClientPKCERequired = async (
  db: Db,
  { clientId }: IsOAuthClientPKCERequiredParams
): Promise<boolean> => {
  // A narrow read instead of `getClientFromId`: that one parses the whole row
  // into a `Client`, which refuses a client whose JSON columns are malformed,
  // and this answer must not depend on them.
  const row = await db
    .selectFrom('oauthClient')
    .select('requirePKCE')
    .where('clientId', '=', clientId)
    .limit(1)
    .executeTakeFirst()
  return Boolean(row?.requirePKCE)
}

export const countRecentAppRegistrations = async (
  db: Db,
  { registrationReference, since }: CountRecentAppRegistrationsParams
): Promise<number> => {
  const row = await db
    .selectFrom('oauthClient')
    .select((eb) => eb.fn.countAll().as('count'))
    .where('referenceId', '=', registrationReference)
    .where('createdAt', '>=', timestampValue(since))
    .executeTakeFirst()
  // count(*) is an expression column: a string on PostgreSQL's int8, a number
  // on SQLite.
  return Number(row?.count ?? 0)
}

export const createOAuthClientRegistration = async (
  db: Db,
  params: CreateOAuthClientRegistrationParams
): Promise<void> => {
  const createdAt = new Date(params.createdAt)
  await db
    .insertInto('oauthClient')
    .values({
      id: params.id,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      name: params.name,
      // JSON-array strings, as `oauthClient.scopes` / `redirectUris` have
      // always been stored; better-auth's adapter parses its `string[]`
      // fields back into arrays on read.
      scopes: JSON.stringify(params.scopes),
      clientCredentialsScopes: JSON.stringify(params.clientCredentialsScopes),
      redirectUris: JSON.stringify(params.redirectUris),
      postLogoutRedirectUris: params.postLogoutRedirectUris
        ? JSON.stringify(params.postLogoutRedirectUris)
        : null,
      enableEndSession: params.enableEndSession,
      uri: params.website,
      requirePKCE: params.requirePKCE,
      disabled: params.disabled,
      grantTypes: JSON.stringify(params.grantTypes),
      responseTypes: JSON.stringify(params.responseTypes),
      tokenEndpointAuthMethod: params.tokenEndpointAuthMethod,
      referenceId: params.referenceId,
      metadata: params.metadata,
      createdAt,
      updatedAt: createdAt
    })
    .execute()
}

export const createOAuthAccessToken = async (
  db: Db,
  {
    hashedToken,
    clientId,
    accountId,
    actorId,
    scopes,
    expiresAt
  }: CreateOAuthAccessTokenParams
): Promise<void> => {
  // Mirrors the columns better-auth populates for an issued access token:
  // the `token` column holds the SHA-256 hash (the caller hashes it), `userId`
  // the owning account, and `referenceId` the delegated actor that OAuthGuard
  // resolves the request actor from. Scopes are stored as a JSON array to
  // match the existing oauthClient/oauthAccessToken rows.
  await db
    .insertInto('oauthAccessToken')
    .values({
      id: crypto.randomUUID(),
      token: hashedToken,
      clientId,
      userId: accountId,
      referenceId: actorId,
      scopes: JSON.stringify(scopes),
      expiresAt: new Date(expiresAt),
      createdAt: new Date()
    })
    .execute()
}

export const extendOAuthAccessToken = async (
  db: Db,
  { hashedToken, expiresAt }: ExtendOAuthAccessTokenParams
): Promise<void> => {
  // Keyed on the unique `token` hash, the column OAuthGuard has just read the
  // row by. Revoking an app (Settings → Connected apps, `POST /oauth/revoke`)
  // DELETES its rows, so a token revoked in between matches nothing here and
  // stays gone. better-auth's own soft revocation — the `revoked` column its
  // session-delete hook stamps on tokens minted from a web session that is
  // signed out or expires — is deliberately not honoured, by this or by
  // OAuthGuard: as on Mastodon, signing out of the web does not sign apps out
  // (see `detachOAuthTokensFromSessions`).
  await db
    .updateTable('oauthAccessToken')
    .set({ expiresAt: new Date(expiresAt) })
    .where('token', '=', hashedToken)
    .execute()
}

export const getAccountConnectedApps = async (
  db: Db,
  { accountId }: GetAccountConnectedAppsParams
): Promise<ConnectedApp[]> => {
  // Each consent row is one "you authorized this app" grant for a (client,
  // actor) pair. Join the registered client for its display name/website.
  // Left join so a grant still lists even if the client metadata is missing.
  const rows = await db
    .selectFrom('oauthConsent')
    .leftJoin('oauthClient', 'oauthClient.clientId', 'oauthConsent.clientId')
    .where('oauthConsent.userId', '=', accountId)
    .select([
      'oauthConsent.clientId as clientId',
      'oauthConsent.referenceId as actorId',
      'oauthConsent.scopes as scopes',
      'oauthConsent.createdAt as authorizedAt',
      'oauthClient.name as name',
      'oauthClient.uri as website'
    ])
    .execute()

  return rows
    .map((row) => {
      const scopes = parseScopeList(row.scopes)
      return ConnectedApp.parse({
        clientId: row.clientId,
        // Normalize an empty-string referenceId to null (matching OAuthGuard's
        // `|| null`) so a no-actor grant lists and revokes consistently — a
        // revoke for it sends no actorId and matches on `is null`.
        actorId: row.actorId || null,
        name: row.name ?? null,
        website: row.website ?? null,
        scopes,
        authorizedAt: row.authorizedAt ?? 0,
        // OpenID Connect grants are sign-in (SSO) connections; everything else
        // is an API client.
        signIn: scopes.includes('openid')
      })
    })
    .sort((a, b) => b.authorizedAt - a.authorizedAt)
}

type GrantTable = 'oauthAccessToken' | 'oauthRefreshToken' | 'oauthConsent'

// Scopes a delete on one of the grant tables to the actor the grant belongs
// to. A no-actor grant may be persisted as NULL or as an empty string, and the
// read path normalizes both to null — so revoke must match both to stay in
// sync. A concrete actorId matches exactly.
const forActor = <TB extends GrantTable>(
  eb: ExpressionBuilder<DB, TB>,
  actorId: string | null
) => {
  const referenceId = sql.ref('referenceId')
  if (actorId === null) {
    return eb.or([eb(referenceId, 'is', null), eb(referenceId, '=', '')])
  }
  return eb(referenceId, '=', actorId)
}

export const revokeAccountConnectedApp = (
  db: Db,
  { accountId, clientId, actorId }: RevokeAccountConnectedAppParams
): Promise<void> =>
  // Scope every delete to the owning account so one account can never revoke
  // another's grant, and to the specific actor so revoking one actor's grant
  // leaves the same app authorized under the account's other actors.
  //
  // Run the three deletes in one transaction so a partial failure can't leave
  // a half-revoked grant — e.g. tokens gone but a live refresh token still
  // able to mint new access tokens, or a lingering consent row.
  inTransaction(db, async (trx) => {
    // Delete access tokens before refresh tokens: oauthAccessToken.refreshId
    // is a FK into oauthRefreshToken, so the children must go first.
    await trx
      .deleteFrom('oauthAccessToken')
      .where('clientId', '=', clientId)
      .where('userId', '=', accountId)
      .where((eb) => forActor(eb, actorId))
      .execute()
    await trx
      .deleteFrom('oauthRefreshToken')
      .where('clientId', '=', clientId)
      .where('userId', '=', accountId)
      .where((eb) => forActor(eb, actorId))
      .execute()
    await trx
      .deleteFrom('oauthConsent')
      .where('clientId', '=', clientId)
      .where('userId', '=', accountId)
      .where((eb) => forActor(eb, actorId))
      .execute()
  })

export const oauthQueries = {
  getClientFromId,
  getOAuthAccessTokenByHash,
  isOAuthClientPKCERequired,
  countRecentAppRegistrations,
  createOAuthClientRegistration,
  createOAuthAccessToken,
  extendOAuthAccessToken,
  getAccountConnectedApps,
  revokeAccountConnectedApp
}
