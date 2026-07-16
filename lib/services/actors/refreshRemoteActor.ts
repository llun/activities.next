import { recordActorIfNeeded } from '@/lib/actions/utils'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'

// A failed refresh suppresses further attempts for the same actor for this
// long: without it, every request for an actor whose home server is down
// would re-fire a blocking outbound fetch (the stale-refresh failure path in
// recordActorIfNeeded persists nothing, so nothing else re-arms it).
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000

// How long a request waits for an in-flight refresh before serving the stored
// actor. The refresh keeps running past the budget and persists its result,
// so the next request reads fresh data — the budget only bounds how long a
// slow remote can hold up an account response.
const REFRESH_WAIT_BUDGET_MS = 5_000

// Opportunistic sweep threshold for the failure map so it cannot grow
// unbounded across many dead remotes. The sweep itself is throttled: when the
// map is over the threshold but every entry is still inside the cooldown, an
// unthrottled sweep would run a full O(n) no-op scan on every failure.
const FAILURE_SWEEP_SIZE = 1_000
const FAILURE_SWEEP_INTERVAL_MS = 60 * 1000

const inflightRefreshes = new Map<string, Promise<Actor | null>>()
const failedRefreshesAt = new Map<string, number>()
let lastFailureSweepAt = 0

// Test-only: module-level cooldown/in-flight state leaks between tests that
// reuse actor ids, so suites exercising the refresh reset it in beforeEach.
export const resetRefreshRemoteActorStateForTesting = () => {
  inflightRefreshes.clear()
  failedRefreshesAt.clear()
  lastFailureSweepAt = 0
}

const recordRefreshFailure = (actorId: string) => {
  const now = Date.now()
  if (
    failedRefreshesAt.size >= FAILURE_SWEEP_SIZE &&
    now - lastFailureSweepAt >= FAILURE_SWEEP_INTERVAL_MS
  ) {
    lastFailureSweepAt = now
    const cutoff = now - FAILURE_COOLDOWN_MS
    for (const [id, failedAt] of failedRefreshesAt) {
      if (failedAt < cutoff) failedRefreshesAt.delete(id)
    }
  }
  failedRefreshesAt.set(actorId, now)
}

const startRefresh = ({
  database,
  actorId,
  signingActor
}: {
  database: Database
  actorId: string
  signingActor?: Actor
}): Promise<Actor | null> => {
  const refresh = recordActorIfNeeded({ actorId, database, signingActor })
    .then((refreshed) => {
      // recordActorIfNeeded returns undefined when the stale-path remote
      // fetch fails — a failure for cooldown purposes, like a rejection.
      if (!refreshed) {
        recordRefreshFailure(actorId)
        return null
      }
      // Hygiene, not behavior: a refresh can only run once the entry has
      // already expired (the cooldown gate precedes it), so dropping the
      // entry just keeps recovered actors from accumulating in the map.
      failedRefreshesAt.delete(actorId)
      return refreshed
    })
    .catch((error) => {
      logger.warn({
        message: 'Failed to refresh remote actor',
        actorId,
        error: error instanceof Error ? error.message : String(error)
      })
      recordRefreshFailure(actorId)
      return null
    })
    .finally(() => {
      inflightRefreshes.delete(actorId)
    })
  inflightRefreshes.set(actorId, refresh)
  return refresh
}

const raceWithBudget = <T>(promise: Promise<T>, budgetMs: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const budget = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), budgetMs)
  })
  return Promise.race([promise, budget]).finally(() => clearTimeout(timer))
}

// Refresh a known remote actor's stored profile and collection counts before
// an account-serving endpoint serializes it, so profile headers built from
// lookup/search responses carry current remote data instead of whatever last
// federated here. recordActorIfNeeded no-ops for recently-synced actors, so
// the steady-state cost is a couple of indexed reads. The refresh is guarded
// for the failure modes a hot account path cannot afford: concurrent requests
// share one in-flight refresh instead of each fetching, a failed refresh
// backs off for FAILURE_COOLDOWN_MS instead of retrying per request, a slow
// remote only delays the response by REFRESH_WAIT_BUDGET_MS (the refresh
// finishes in the background and persists for the next request), and any
// failure falls back to the stored actor. Internal actors (account-backed
// users and the headless signer, which always carries a private key) are
// never refreshed from the network.
export const refreshKnownRemoteActor = async ({
  database,
  actor,
  signingActor
}: {
  database: Database
  actor: Actor
  signingActor?: Actor
}): Promise<Actor> => {
  if (actor.account || actor.privateKey) return actor

  const failedAt = failedRefreshesAt.get(actor.id)
  if (failedAt && Date.now() - failedAt < FAILURE_COOLDOWN_MS) return actor

  const refresh =
    inflightRefreshes.get(actor.id) ??
    startRefresh({ database, actorId: actor.id, signingActor })

  const refreshed = await raceWithBudget(refresh, REFRESH_WAIT_BUDGET_MS)
  return refreshed ?? actor
}

// Record a remote actor that is not stored yet, degrading to null when the
// remote fetch fails: exact-match resolution on the search/lookup paths is
// best-effort, and a downed remote must not turn the whole request into a 500.
export const recordRemoteActorBestEffort = async ({
  actorId,
  database,
  signingActor
}: {
  actorId: string
  database: Database
  signingActor?: Actor
}): Promise<Actor | null> => {
  try {
    return (
      (await recordActorIfNeeded({ actorId, database, signingActor })) ?? null
    )
  } catch (error) {
    logger.warn({
      message: 'Failed to record remote actor',
      actorId,
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}
