import { Knex } from 'knex'

import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
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
  }
})
