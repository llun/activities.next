import { createRequire } from 'node:module'

/**
 * Stands a real React request scope up around a test, so `cache()`d helpers
 * actually memoize.
 *
 * React ships two builds of `cache`. The one Vitest resolves — the client build,
 * under the package's `default` export condition — is a hard passthrough that
 * calls the function every time and never memoizes. Only the `react-server`
 * build, which is what Next.js loads for Server Components and route handlers,
 * keys on the arguments, and it does so only while an async cache dispatcher is
 * installed. That dispatcher *is* the request scope: Next.js swaps a fresh one
 * in per request, which is why a `cache()` result never leaks between them.
 *
 * So a test that wants to observe request-level deduplication has to do both
 * halves itself: load the server build (via `serverCache`, which the test hands
 * to `vi.mock('react', …)` so the module under test gets it) and run the code
 * inside a scope (via `runInReactCacheScope`). Without the first, nothing
 * memoizes; without the second, the server build falls back to the passthrough
 * and nothing memoizes either — the same result a caller outside a request gets
 * in production.
 *
 * Each `runInReactCacheScope` call is one request: a fresh store, restored on
 * the way out. Scopes must be **sequential** — see the reentrancy guard on
 * `runInReactCacheScope` for why concurrent ones cannot work and are refused.
 *
 * This drives React's own `react-server` `cache` rather than a hand-rolled
 * memoizer on purpose. A fake would be testing the fake: React keys primitive
 * arguments through a `Map` and object arguments through a `WeakMap`, and it is
 * exactly that split that makes the positional-primitive contract
 * `getViewerFollow` follows load-bearing. Reaching into
 * `__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE` is the cost,
 * and it is a safe one to pay here because the failure mode is loud: if React
 * renames or reshapes that export, no dispatcher gets installed, `cache` takes
 * its passthrough branch, and the call counts these tests assert go back up —
 * a failing test, never a silent pass.
 */
const require = createRequire(import.meta.url)

type CacheDispatcher = {
  getCacheForType: <T>(create: () => T) => T
}

type ServerReact = {
  cache: <T extends (...args: never[]) => unknown>(fn: T) => T
  __SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: {
    A: CacheDispatcher | null
  }
}

// react's `exports` map publishes the react-server build only under an export
// condition, not as a subpath, so resolve it beside the package manifest rather
// than through the map. Node's CJS require cache keys on the resolved path, so
// every caller here — including a `vi.mock` factory — gets the same instance,
// which is what lets `runInReactCacheScope` install a dispatcher the `cache()`
// wrappers can see.
const loadServerReact = (): ServerReact =>
  require(
    require
      .resolve('react/package.json')
      .replace(/package\.json$/, 'react.react-server.js')
  ) as ServerReact

/**
 * React's real server-build `cache`. Hand this to `vi.mock('react', …)` so the
 * module under test is wrapped by the same implementation Next.js uses.
 */
export const serverCache = loadServerReact().cache

let isScopeActive = false

/**
 * Runs `fn` as if it were one request, with an empty `cache()` store.
 *
 * Scopes must be sequential — `await` each one before starting the next. A
 * second scope entered while one is live throws rather than nesting, because
 * the dispatcher lives in a single mutable global (`internals.A`) that React
 * reads at call time, not an `AsyncLocalStorage` keyed to the caller. Two live
 * scopes therefore cannot be isolated at all: after an `await`, either one's
 * continuation reads whichever dispatcher happens to be installed, so scope A
 * can memoize into scope B's store while both are running. Saving and restoring
 * the previous dispatcher on a stack would fix only the value left behind at the
 * end and make that mid-flight bleed *look* handled.
 *
 * Left unguarded, the symptom was subtle: `Promise.all([runInReactCacheScope(a),
 * runInReactCacheScope(b)])` leaves a live dispatcher installed after both
 * settle, so later code outside any scope gets memoized where production would
 * hand it the passthrough.
 */
export const runInReactCacheScope = async <T>(
  fn: () => Promise<T>
): Promise<T> => {
  if (isScopeActive) {
    throw new Error(
      'runInReactCacheScope is already active. React exposes one global cache ' +
        'dispatcher slot, so concurrent or nested scopes cannot be isolated ' +
        'from each other. Await each scope before starting the next.'
    )
  }

  const internals =
    loadServerReact()
      .__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
  const previousDispatcher = internals.A
  const store = new Map<unknown, unknown>()
  isScopeActive = true
  internals.A = {
    getCacheForType: <C>(create: () => C): C => {
      if (!store.has(create)) store.set(create, create())
      return store.get(create) as C
    }
  }
  try {
    return await fn()
  } finally {
    internals.A = previousDispatcher
    isScopeActive = false
  }
}
