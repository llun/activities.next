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
 * the way out, so scopes neither leak into each other nor into unrelated tests.
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

/** Runs `fn` as if it were one request, with an empty `cache()` store. */
export const runInReactCacheScope = async <T>(
  fn: () => Promise<T>
): Promise<T> => {
  const internals =
    loadServerReact()
      .__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
  const previousDispatcher = internals.A
  const store = new Map<unknown, unknown>()
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
  }
}
