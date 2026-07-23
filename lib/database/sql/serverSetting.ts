import { Knex } from 'knex'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  DeleteServerSettingParams,
  GetServerSettingParams,
  ServerSettingData,
  ServerSettingDatabase,
  SetServerSettingParams
} from '@/lib/types/database/operations'

type SQLServerSetting = {
  key: string
  value: string
  createdAt: number | Date | string
  updatedAt: number | Date | string
}

const toServerSetting = (row: SQLServerSetting): ServerSettingData => ({
  key: row.key,
  value: JSON.parse(row.value),
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt)
})

export const ServerSettingSQLDatabaseMixin = (
  database: Knex
): ServerSettingDatabase => ({
  async getServerSetting({ key }: GetServerSettingParams) {
    const row = await database<SQLServerSetting>('server_settings')
      .where({ key })
      .first()
    return row ? toServerSetting(row) : null
  },

  async getAllServerSettings() {
    const rows = await database<SQLServerSetting>('server_settings').orderBy(
      'key',
      'asc'
    )
    return rows.map(toServerSetting)
  },

  async setServerSetting({ key, value }: SetServerSettingParams) {
    const currentTime = new Date()
    // JSON-encode so the single text column round-trips any value shape
    // (string, number, boolean, string[]). Upsert keeps the original
    // createdAt while overwriting value + updatedAt.
    const serialized = JSON.stringify(value)
    await database('server_settings')
      .insert({
        key,
        value: serialized,
        createdAt: currentTime,
        updatedAt: currentTime
      })
      .onConflict('key')
      .merge({ value: serialized, updatedAt: currentTime })

    // The row is guaranteed to exist after the upsert.
    const row = (await database<SQLServerSetting>('server_settings')
      .where({ key })
      .first()) as SQLServerSetting
    return toServerSetting(row)
  },

  async setServerSettings(entries: SetServerSettingParams[]) {
    if (entries.length === 0) return
    // Upsert the whole batch in one transaction so a mid-batch failure rolls
    // back — the admin PATCH is genuinely all-or-nothing.
    const currentTime = new Date()
    await database.transaction(async (trx) => {
      for (const { key, value } of entries) {
        const serialized = JSON.stringify(value)
        await trx('server_settings')
          .insert({
            key,
            value: serialized,
            createdAt: currentTime,
            updatedAt: currentTime
          })
          .onConflict('key')
          .merge({ value: serialized, updatedAt: currentTime })
      }
    })
  },

  async deleteServerSetting({ key }: DeleteServerSettingParams) {
    const deleted = await database('server_settings').where({ key }).delete()
    return deleted > 0
  }
})
