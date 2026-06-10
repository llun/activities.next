import crypto from 'crypto'
import { Knex } from 'knex'

import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  CreateOAuthAccessTokenParams,
  GetClientFromAccessTokenParams,
  GetClientFromIdParams,
  GetClientFromNameParams,
  OAuthDatabase
} from '@/lib/types/database/operations'
import { Client } from '@/lib/types/oauth2/client'

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
    token,
    clientId,
    accountId,
    actorId,
    scopes,
    expiresAt
  }: CreateOAuthAccessTokenParams) {
    // Mirrors the columns better-auth populates for an issued access token:
    // `token` holds the SHA-256 hash (the caller hashes it), `userId` the
    // owning account, and `referenceId` the delegated actor that OAuthGuard
    // resolves the request actor from. Scopes are stored as a JSON array to
    // match the existing oauthClient/oauthAccessToken rows.
    await database('oauthAccessToken').insert({
      id: crypto.randomUUID(),
      token,
      clientId,
      userId: accountId,
      referenceId: actorId,
      scopes: JSON.stringify(scopes),
      expiresAt: new Date(expiresAt),
      createdAt: new Date()
    })
  }
})
