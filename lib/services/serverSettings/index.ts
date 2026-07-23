import {
  DEFAULT_SERVER_SETTINGS,
  ResolvedServerSettings,
  SERVER_SETTING_FIELDS,
  SERVER_SETTING_FIELDS_BY_KEY,
  ServerSettingTab
} from '@/lib/config/serverSettings'
import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { ServerSettingValue } from '@/lib/types/database/operations'

// Resolves database-backed server settings using env -> database -> default
// precedence. An env var always wins and locks its field; otherwise a stored
// database row wins; otherwise the registry default applies. Resolved values
// are cached per database instance with a short TTL so hot paths (inbox
// verification, outbound request fan-out) do not pay a database read per call.

const CACHE_TTL_MS = 30_000

export interface ServerSettingLock {
  locked: boolean
  envVar?: string
}

export interface ServerSettingsView {
  settings: ResolvedServerSettings
  locks: Record<string, ServerSettingLock>
}

export type ServerSettingRejectionReason = 'unknown' | 'locked' | 'invalid'

export interface ServerSettingRejection {
  key: string
  reason: ServerSettingRejectionReason
}

export interface ServerSettingUpdateResult {
  view: ServerSettingsView
  rejected: ServerSettingRejection[]
  applied: boolean
}

type CacheEntry = { view: ServerSettingsView; expiresAt: number }

// Cache is keyed by the database instance so the production singleton is cached
// while each test's throwaway database resolves independently. A null database
// (no configured backend) has its own slot.
const cacheByDatabase = new WeakMap<Database, CacheEntry>()
let nullDatabaseCache: CacheEntry | null = null

const resolve = async (
  database: Database | null
): Promise<ServerSettingsView> => {
  const settings = structuredClone(DEFAULT_SERVER_SETTINGS)
  const locks: Record<string, ServerSettingLock> = {}

  let storedByKey = new Map<string, ServerSettingValue>()
  if (database) {
    try {
      const rows = await database.getAllServerSettings()
      storedByKey = new Map(rows.map((row) => [row.key, row.value]))
    } catch {
      // A settings read failure must never take down a request path; fall back
      // to env + defaults.
      storedByKey = new Map()
    }
  }

  for (const settingField of SERVER_SETTING_FIELDS) {
    // Database value wins over the default, when present and still valid.
    const storedValue = storedByKey.get(settingField.key)
    if (storedValue !== undefined) {
      const parsed = settingField.schema.safeParse(storedValue)
      if (parsed.success) settingField.set(settings, parsed.data)
    }

    // Env override wins over everything and locks the field.
    const envValue = settingField.readEnv()
    if (envValue !== undefined) {
      settingField.set(settings, envValue)
      locks[settingField.key] = {
        locked: true,
        envVar: settingField.envVar
      }
    } else {
      locks[settingField.key] = {
        locked: false,
        envVar: settingField.envVar
      }
    }
  }

  return { settings, locks }
}

const readCache = (database: Database | null, now: number) => {
  const entry = database ? cacheByDatabase.get(database) : nullDatabaseCache
  return entry && entry.expiresAt > now ? entry.view : null
}

const writeCache = (
  database: Database | null,
  view: ServerSettingsView,
  now: number
) => {
  const entry: CacheEntry = { view, expiresAt: now + CACHE_TTL_MS }
  if (database) cacheByDatabase.set(database, entry)
  else nullDatabaseCache = entry
}

// Full resolved settings + lock metadata for the admin UI/API. Cached.
export const getServerSettingsView = async (
  database: Database | null = getDatabase()
): Promise<ServerSettingsView> => {
  const now = Date.now()
  const cached = readCache(database, now)
  if (cached) return cached

  const view = await resolve(database)
  writeCache(database, view, now)
  return view
}

// The resolved values consumers read (limits, policy, identity). Cached.
export const getResolvedServerSettings = async (
  database: Database | null = getDatabase()
): Promise<ResolvedServerSettings> =>
  (await getServerSettingsView(database)).settings

// Drops the cached view so the next read reflects a fresh env/database state.
export const invalidateServerSettingsCache = (
  database: Database | null = getDatabase()
) => {
  if (database) cacheByDatabase.delete(database)
  else nullDatabaseCache = null
}

// Applies a partial { key: value } patch atomically: every entry is validated
// against its registry schema and rejected if the key is unknown, env-locked,
// or fails validation. When anything is rejected, nothing is written.
export const updateServerSettings = async (
  database: Database,
  patch: Record<string, unknown>
): Promise<ServerSettingUpdateResult> => {
  const view = await getServerSettingsView(database)
  const validated: { key: string; value: ServerSettingValue }[] = []
  const rejected: ServerSettingRejection[] = []

  for (const [key, value] of Object.entries(patch)) {
    const settingField = SERVER_SETTING_FIELDS_BY_KEY[key]
    if (!settingField) {
      rejected.push({ key, reason: 'unknown' })
      continue
    }
    if (view.locks[key]?.locked) {
      rejected.push({ key, reason: 'locked' })
      continue
    }
    const parsed = settingField.schema.safeParse(value)
    if (!parsed.success) {
      rejected.push({ key, reason: 'invalid' })
      continue
    }
    validated.push({ key, value: parsed.data as ServerSettingValue })
  }

  if (rejected.length > 0) {
    return { view, rejected, applied: false }
  }

  for (const { key, value } of validated) {
    await database.setServerSetting({ key, value })
  }
  invalidateServerSettingsCache(database)
  const updated = await getServerSettingsView(database)
  return { view: updated, rejected: [], applied: true }
}

// Field metadata (key, tab, env var) for the admin API to describe each field.
export const getServerSettingFieldsMeta = (): {
  key: string
  group: ServerSettingTab
  envVar?: string
}[] =>
  SERVER_SETTING_FIELDS.map(({ key, group, envVar }) => ({
    key,
    group,
    envVar
  }))
