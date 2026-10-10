import { Knex } from 'knex'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
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
  async getAllServerSettings() {
    const rows = await database<SQLServerSetting>('server_settings').orderBy(
      'key',
      'asc'
    )
    return rows.map(toServerSetting)
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
  }
})
