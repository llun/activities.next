import type {
  ServerSettingData,
  SetServerSettingParams
} from '@/lib/database/domains/serverSetting/types'
import { type Db, inTransaction } from '@/lib/database/kysely'

export const getAllServerSettings = async (
  db: Db
): Promise<ServerSettingData[]> => {
  const rows = await db
    .selectFrom('server_settings')
    .select(['key', 'value', 'createdAt', 'updatedAt'])
    .orderBy('key', 'asc')
    .execute()
  return rows.map((row) => ({
    key: row.key,
    value: JSON.parse(row.value),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }))
}

export const setServerSettings = async (
  db: Db,
  entries: SetServerSettingParams[]
): Promise<void> => {
  if (entries.length === 0) return
  // Upsert the whole batch in one transaction so a mid-batch failure rolls
  // back — the admin PATCH is genuinely all-or-nothing.
  const currentTime = new Date()
  await inTransaction(db, async (trx) => {
    for (const { key, value } of entries) {
      const serialized = JSON.stringify(value)
      await trx
        .insertInto('server_settings')
        .values({
          key,
          value: serialized,
          createdAt: currentTime,
          updatedAt: currentTime
        })
        .onConflict((oc) =>
          oc
            .column('key')
            .doUpdateSet({ value: serialized, updatedAt: currentTime })
        )
        .execute()
    }
  })
}

export const serverSettingQueries = {
  getAllServerSettings,
  setServerSettings
}
