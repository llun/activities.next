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
import { logger } from '@/lib/utils/logger'

// Resolves database-backed server settings using env -> database -> default
// precedence. An env var always wins and locks its field; otherwise a stored
// database row wins; otherwise the registry default applies. Resolved values
// are cached per database instance with a short TTL so hot paths (inbox
// verification, outbound request fan-out) do not pay a database read per call.
//
// The TTL also bounds how long another instance/pod serves a stale value after
// an admin saves: an admin's own write invalidates the local cache immediately,
// but on a multi-instance deployment other instances converge within one TTL.
// Keep it short so a security-tightening change (closing registration, enabling
// an allowlist) propagates promptly.

const CACHE_TTL_MS = 15_000
// A read failure caches env + defaults only briefly, so the resolver recovers
// within seconds once the database is healthy again instead of serving the
// fallback for a full TTL.
const FAILURE_CACHE_TTL_MS = 2_000

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

// Build the resolved view from the already-read stored rows (no I/O):
// default -> database (valid rows only) -> env (wins and locks the field).
const buildView = (
  storedByKey: Map<string, ServerSettingValue>
): ServerSettingsView => {
  const settings = structuredClone(DEFAULT_SERVER_SETTINGS)
  const locks: Record<string, ServerSettingLock> = {}

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
      locks[settingField.key] = { locked: true, envVar: settingField.envVar }
    } else {
      locks[settingField.key] = { locked: false, envVar: settingField.envVar }
    }
  }

  return { settings, locks }
}

const readCacheEntry = (database: Database | null): CacheEntry | null =>
  (database ? cacheByDatabase.get(database) : nullDatabaseCache) ?? null

const writeCache = (
  database: Database | null,
  view: ServerSettingsView,
  expiresAt: number
) => {
  const entry: CacheEntry = { view, expiresAt }
  if (database) cacheByDatabase.set(database, entry)
  else nullDatabaseCache = entry
}

// Full resolved settings + lock metadata for the admin UI/API. Cached.
export const getServerSettingsView = async (
  database: Database | null = getDatabase()
): Promise<ServerSettingsView> => {
  const now = Date.now()
  const entry = readCacheEntry(database)
  if (entry && entry.expiresAt > now) return entry.view

  // No configured database: env + defaults only.
  if (!database) {
    const view = buildView(new Map())
    writeCache(null, view, now + CACHE_TTL_MS)
    return view
  }

  let storedByKey: Map<string, ServerSettingValue>
  try {
    const rows = await database.getAllServerSettings()
    storedByKey = new Map(rows.map((row) => [row.key, row.value]))
  } catch (error) {
    // A settings read failure must never take down a request path, but it must
    // also not silently revert an admin's stored policy (a closed registration,
    // an allowlist) to the permissive default. Prefer the last-known-good cached
    // view even if it has expired; only when there is none fall back to env +
    // defaults, cached briefly so recovery is fast. Always log so the fallback
    // window is observable.
    logger.error({
      message:
        'serverSettings: failed to read stored settings; serving cached values or env/defaults',
      error: error instanceof Error ? error.message : String(error)
    })
    if (entry) return entry.view
    const view = buildView(new Map())
    writeCache(database, view, now + FAILURE_CACHE_TTL_MS)
    return view
  }

  const view = buildView(storedByKey)
  writeCache(database, view, now + CACHE_TTL_MS)
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

// Applies a partial { key: value } patch: every entry is validated against its
// registry schema and rejected if the key is unknown, env-locked, or fails
// validation. When anything is rejected, nothing is written. Accepted entries
// are persisted in a single transaction, so a mid-batch database failure rolls
// back and the patch is genuinely all-or-nothing.
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

  try {
    await database.setServerSettings(validated)
  } finally {
    // Invalidate even if the write threw so the cache never masks the persisted
    // state (a rolled-back transaction leaves the stored values unchanged).
    invalidateServerSettingsCache(database)
  }
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
