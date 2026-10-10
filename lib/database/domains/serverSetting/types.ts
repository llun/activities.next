// Parameter and result types of the serverSetting domain.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.

// A single database-backed instance server setting, stored as one key/value
// row. `key` is the registry key (e.g. `posts.maxCharacters`) and `value` is
// the decoded JSON value. `createdAt`/`updatedAt` are epoch milliseconds in the
// domain shape regardless of the backend's timestamp storage. The env ->
// database -> default resolver overlays these rows onto env/default values.
export type ServerSettingValue = string | number | boolean | string[] | null

export type ServerSettingData = {
  key: string
  value: ServerSettingValue
  createdAt: number
  updatedAt: number
}

export type SetServerSettingParams = { key: string; value: ServerSettingValue }
export type DeleteServerSettingParams = { key: string }

export interface ServerSettingDatabase {
  // Every stored setting row, ordered by key ascending.
  getAllServerSettings(): Promise<ServerSettingData[]>
  // Upsert several settings in a single transaction (all-or-nothing).
  setServerSettings(params: SetServerSettingParams[]): Promise<void>
}
