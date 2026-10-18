import { type Config, getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import {
  type HostRuleConfig,
  normalizeServedDomainChoice
} from '@/lib/utils/host'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

/**
 * The active (`on`) rows of the `domains` table, held in memory so the
 * SYNCHRONOUS host-trust checks (`headerHost`, `selectHeaderHost`, the
 * signature host in `ActivityPubVerifyGuard`, CORS) can include them without a
 * database read per call.
 *
 * How fresh it is:
 * - `startServedDomainRefresher` (instrumentation, the queue worker) loads it
 *   at boot and every `SERVED_DOMAIN_REFRESH_MS`.
 * - Every admin write refreshes it at once (`refreshServedDomainsAfterWrite`).
 * - `ensureServedDomainsFresh` is awaited on the async request paths where
 *   trust decides something durable (auth, sign-up, local-domain matching),
 *   by every `traceApiRoute` handler, and before `headerHost` elsewhere.
 * - A sync read of a snapshot older than the refresh interval starts a
 *   background refresh and uses what it has.
 *
 * It fails CLOSED: a snapshot whose last successful load is older than
 * `SERVED_DOMAIN_MAX_STALE_MS` contributes no database domains at all, so a
 * stopped refresher or a database outage can at worst leave a turned-off
 * domain trusted for that long, never indefinitely. A process with no
 * registered database (tests, one-off scripts) only ever sees the env domains.
 *
 * The proxy (`proxy.ts`) does not use this: it has no database and stays on
 * the env-only `getProxyHostConfig`.
 */

export const SERVED_DOMAIN_REFRESH_MS = 30_000
export const SERVED_DOMAIN_MAX_STALE_MS = 5 * 60_000

type Snapshot = {
  domains: readonly string[]
  loadedAt: number
}

const EMPTY_SNAPSHOT: Snapshot = { domains: [], loadedAt: 0 }

type SnapshotState = {
  snapshot: Snapshot
  registeredDatabase: Database | null
  inflight: Promise<void> | null
  refreshTimer: ReturnType<typeof setInterval> | null
}

// Next bundles instrumentation.ts, route handlers and server components as
// separate module graphs, so a module-level `let` here would be a different
// variable in each: the snapshot `register()` loads would never reach a page.
// One process-wide state on globalThis is shared by every copy of the module.
const STATE_KEY = Symbol.for('activities.next.servedDomainSnapshot')
const globalState = globalThis as typeof globalThis & {
  [STATE_KEY]?: SnapshotState
}
const state: SnapshotState = (globalState[STATE_KEY] ??= {
  snapshot: EMPTY_SNAPSHOT,
  registeredDatabase: null,
  inflight: null,
  refreshTimer: null
})

// Re-normalise on load: a row is written through the same normaliser, but the
// table is the one place a domain enters trust from data rather than env, so a
// value that is not a plain authority (a wildcard, a path, a hand-edited row)
// is dropped here rather than trusted.
const toTrustedDomains = (domains: readonly string[]): string[] => [
  ...new Set(
    domains
      .map((domain) => normalizeServedDomainChoice(domain))
      .filter((domain): domain is string => Boolean(domain))
  )
]

const loadSnapshot = async (database: Database): Promise<void> => {
  try {
    const rows = await database.getActiveServedDomains()
    state.snapshot = {
      domains: toTrustedDomains(rows.map((row) => row.domain)),
      loadedAt: Date.now()
    }
  } catch (error) {
    logger.error({
      message: 'Failed to load the active served domains',
      err: toLoggableError(error)
    })
  }
}

/**
 * Reloads the snapshot from `database` (or the registered one). Concurrent
 * callers share one load.
 */
export const refreshServedDomains = async (
  database: Database | null = state.registeredDatabase
): Promise<void> => {
  if (!database) return
  if (!state.registeredDatabase) state.registeredDatabase = database
  if (state.inflight) return state.inflight
  state.inflight = loadSnapshot(database).finally(() => {
    state.inflight = null
  })
  return state.inflight
}

/**
 * Reloads after an admin write. A load already in flight may have read the
 * table before the write committed, so joining it could keep the old list for
 * another refresh interval: wait for it, then load again.
 */
export const refreshServedDomainsAfterWrite = async (
  database: Database
): Promise<void> => {
  await state.inflight
  return refreshServedDomains(database)
}

const isStale = (now: number) =>
  now - state.snapshot.loadedAt > SERVED_DOMAIN_REFRESH_MS

/**
 * Awaits a refresh when the snapshot is older than the refresh interval. No
 * query when it is fresh, and a no-op when no database is registered.
 */
export const ensureServedDomainsFresh = async (): Promise<void> => {
  if (!state.registeredDatabase) return
  if (isStale(Date.now())) await refreshServedDomains(state.registeredDatabase)
}

/**
 * The active database domains for a synchronous caller: the snapshot, or none
 * when it is past `SERVED_DOMAIN_MAX_STALE_MS`. Starts a background refresh
 * when it is older than the refresh interval.
 */
export const getActiveServedDomainNames = (): readonly string[] => {
  const now = Date.now()
  if (state.registeredDatabase && isStale(now) && !state.inflight) {
    void refreshServedDomains(state.registeredDatabase)
  }
  if (now - state.snapshot.loadedAt > SERVED_DOMAIN_MAX_STALE_MS) return []
  return state.snapshot.domains
}

/** Loads the snapshot now and keeps it fresh for the life of the process. */
export const startServedDomainRefresher = (database: Database): void => {
  state.registeredDatabase = database
  void refreshServedDomains(database)
  if (state.refreshTimer) return
  state.refreshTimer = setInterval(() => {
    void refreshServedDomains(database)
  }, SERVED_DOMAIN_REFRESH_MS)
  state.refreshTimer.unref?.()
}

type ServedHostConfig = Pick<Config, 'host' | 'trustedHosts'> & {
  servedDomains: readonly string[]
}

const servedHostConfigCache = new WeakMap<
  Pick<Config, 'host' | 'trustedHosts'>,
  { domains: readonly string[]; value: ServedHostConfig }
>()

/**
 * The host-rule config every request-time trust check uses: the primary host,
 * `ACTIVITIES_TRUSTED_HOSTS`, and the active database domains. The same object
 * comes back until the snapshot changes, so matchers cached per config object
 * (`createLocalDomainMatcher`) are rebuilt only when the domain list does.
 */
export const getServedHostConfig = (
  config: Pick<Config, 'host' | 'trustedHosts'> = getConfig()
): ServedHostConfig & HostRuleConfig => {
  const domains = getActiveServedDomainNames()
  const cached = servedHostConfigCache.get(config)
  if (cached && cached.domains === domains) return cached.value
  const value: ServedHostConfig = {
    host: config.host,
    trustedHosts: config.trustedHosts,
    servedDomains: domains
  }
  servedHostConfigCache.set(config, { domains, value })
  return value
}

/** Test helper: sets the snapshot as if it had just been loaded. */
export const setServedDomainsForTests = (domains: readonly string[]) => {
  state.snapshot = { domains: toTrustedDomains(domains), loadedAt: Date.now() }
}

/** Test helper: forgets the snapshot, the database and the timer. */
export const resetServedDomainsForTests = () => {
  state.snapshot = EMPTY_SNAPSHOT
  state.registeredDatabase = null
  state.inflight = null
  if (state.refreshTimer) clearInterval(state.refreshTimer)
  state.refreshTimer = null
}
