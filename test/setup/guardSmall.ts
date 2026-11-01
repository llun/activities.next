import { syncBuiltinESMExports } from 'node:module'
import path from 'node:path'
import timers from 'node:timers'
import timersPromises from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { beforeEach, onTestFinished, vi } from 'vitest'

import { setOutboundSocketPolicy } from './blockOutboundNetwork'
import * as guards from './guardViolations'

// Small tests run with no real I/O at all: no database, no filesystem, no
// child process, no socket (not even loopback — the outbound trap is tightened
// to 'strict' below) and no long real timer. A violation means the test is
// really medium or large and must be tagged (`@vitest-size`) or moved. These
// guards catch honest accidents and are not a sandbox: timers/promises
// scheduler.wait and a temp-dir symlink can still get past them, and the
// per-size time limit is the backstop.

const violations = guards.createViolationRecorder()

// Guard-test seam: test/guardSmall.test.ts triggers violations on purpose.
export const takeSmallGuardViolations = () => violations.take()

setOutboundSocketPolicy('strict')

// Every filesystem write is forbidden. A read is blocked only inside the
// repository, outside node_modules: fixtures, snapshots and config files are
// the test's own inputs, while node_modules keeps Vitest's and other
// packages' internals working. A read outside the repository is allowed:
// system files (/proc/self/exe, /usr/bin/ldd, …) are probed lazily by
// native-module helpers such as detect-libc (pulled in by sharp) — on Linux,
// not on a dev machine — and are never the test's fixture.
// The setup file's own URL anchors the repository root (test/setup/..)
// regardless of the directory Vitest was launched from; `new URL(…,
// import.meta.url)` is avoided because Vite rewrites that pattern for assets.
const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
)
const isNodeModules = (resolved: string): boolean =>
  resolved.includes('/node_modules/') || resolved.endsWith('/node_modules')
const isInsideRepository = (resolved: string): boolean =>
  resolved === REPOSITORY_ROOT || resolved.startsWith(`${REPOSITORY_ROOT}/`)
guards.guardBuiltins(
  violations,
  'small',
  () => false,
  (resolved) => isNodeModules(resolved) || !isInsideRepository(resolved)
)

// A real timer of 100ms or more is a real wait: throw when it is armed while a
// test runs, whatever route arms it — the global setTimeout/setInterval, the
// node:timers module, node:timers/promises, or promisify(setTimeout). Fake
// timers are unaffected: calls through the global reach the fakes directly,
// and a long wait that still lands on these wrappers is handed to them
// (fakeTimersActive below); next/dynamic's loading
// delay is exempt, as in vitest.setup.ts's guard.
const LONG_TIMER_MS = 100
let guardingTimers = false
const longTimerViolation = (via: string, delay: number): Error => {
  violations.record('long-timer', `${delay}ms`)
  return new Error(
    `A real ${via} of ${delay}ms is blocked in small tests — use fake timers (vi.useFakeTimers()), shorten the delay, or tag the file \`@vitest-size medium\`.`
  )
}
const isLongWait = (handler: unknown, delay: unknown): delay is number =>
  guardingTimers &&
  typeof handler === 'function' &&
  typeof delay === 'number' &&
  delay >= LONG_TIMER_MS

// vi.useFakeTimers() swaps globalThis.setTimeout for the fake, while named
// node:timers imports keep landing here, so a long wait must be handed to the
// fake instead of judged. The fakes — and only they — carry a `clock`
// property: the jsdom timer guard in vitest.setup.ts wraps the global too,
// so a global that differs from this wrapper is not proof of fake timers,
// and vi.isFakeTimers() cannot be used either: building vitest's timer state
// probes the global and would re-enter this wrapper. Reading the property
// calls nothing. Only judged (long) waits are handed off: a caller that
// captured this wrapper before the fakes were installed and wants a real
// wait (as DraftsProvider.queue.test.tsx's settle() does) still gets one,
// because waits under LONG_TIMER_MS are never judged.
// Detected per timer: only the faked timer's global carries the `clock`
// marker, so a long wait on the other timer is still judged against the
// real one instead of being handed to a global that is this very wrapper.
const fakeTimersActive = (timer: 'setTimeout' | 'setInterval'): boolean =>
  (globalThis[timer] as typeof setTimeout & { clock?: unknown }).clock !==
  undefined

const nativeSetTimeout = globalThis.setTimeout
const guardedSetTimeout = ((...args: Parameters<typeof setTimeout>) => {
  const [handler, delay] = args
  if (isLongWait(handler, delay)) {
    if (fakeTimersActive('setTimeout')) {
      return (globalThis.setTimeout as typeof setTimeout)(...args)
    }
    const stack = guards.captureStack()
    if (!/loadable\.shared-runtime/.test(stack)) {
      throw longTimerViolation('setTimeout', delay)
    }
  }
  return nativeSetTimeout(...args)
}) as typeof setTimeout
globalThis.setTimeout = guardedSetTimeout

const nativeSetInterval = globalThis.setInterval
const guardedSetInterval = ((...args: Parameters<typeof setInterval>) => {
  const [handler, delay] = args
  if (isLongWait(handler, delay)) {
    if (fakeTimersActive('setInterval')) {
      return (globalThis.setInterval as typeof setInterval)(...args)
    }
    throw longTimerViolation('setInterval', delay)
  }
  return nativeSetInterval(...args)
}) as typeof setInterval
globalThis.setInterval = guardedSetInterval

// promisify(setTimeout) would otherwise bypass the wrapper through the
// native's promisify.custom implementation, so install a custom that judges
// the delay first and then delegates to the native one.
const nativeSetTimeoutCustom = Reflect.get(
  nativeSetTimeout,
  promisify.custom
) as ((delay?: number, ...rest: unknown[]) => Promise<unknown>) | undefined
Object.defineProperty(guardedSetTimeout, promisify.custom, {
  value: (delay?: number, ...rest: unknown[]) => {
    if (guardingTimers && typeof delay === 'number' && delay >= LONG_TIMER_MS) {
      throw longTimerViolation('promisify(setTimeout)', delay)
    }
    return nativeSetTimeoutCustom?.(delay, ...rest)
  }
})

// The node:timers module exports the same functions the globals did, and
// node:timers/promises arms the same waits through its promise API; wrap both
// and syncBuiltinESMExports() so named imports (`import { setTimeout } from
// 'node:timers'`) see the wrappers too.
timers.setTimeout = guardedSetTimeout
timers.setInterval = guardedSetInterval
const nativePromisesSetTimeout = timersPromises.setTimeout
const nativePromisesSetInterval = timersPromises.setInterval
timersPromises.setTimeout = ((delay?: number, ...rest: unknown[]) => {
  if (guardingTimers && typeof delay === 'number' && delay >= LONG_TIMER_MS) {
    throw longTimerViolation('setTimeout (node:timers/promises)', delay)
  }
  return nativePromisesSetTimeout(delay, ...rest)
}) as typeof timersPromises.setTimeout
timersPromises.setInterval = ((delay?: number, ...rest: unknown[]) => {
  if (guardingTimers && typeof delay === 'number' && delay >= LONG_TIMER_MS) {
    throw longTimerViolation('setInterval (node:timers/promises)', delay)
  }
  return nativePromisesSetInterval(delay, ...rest)
}) as typeof timersPromises.setInterval
syncBuiltinESMExports()

// The guard only judges timers armed while a test runs; onTestFinished may
// only be registered inside a hook (as blockOutboundNetwork does it).
beforeEach(() => {
  guardingTimers = true
  onTestFinished(() => {
    guardingTimers = false
  })
})

violations.installFailHooks('small-test')

// The application database is unreachable by this route in a small test; a
// test file's own vi.mock takes priority over this one.
vi.mock('@/lib/database/connection', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    createDatabaseConnection: () => {
      // Recorded like every other block, so a caller that swallows the throw
      // still fails the test.
      violations.record('db-connection', 'createDatabaseConnection')
      throw new Error('createDatabaseConnection is blocked in small tests')
    }
  }
})
