import { promisify } from 'node:util'
import { beforeEach, onTestFinished, vi } from 'vitest'

import { setOutboundSocketPolicy } from './blockOutboundNetwork'
import * as guards from './guardViolations'

// Small tests run with no real I/O at all: no database, no filesystem, no
// child process, no socket (not even loopback — the outbound trap is tightened
// to 'strict' below) and no long real timer. A violation means the test is
// really medium or large and must be tagged (`@vitest-size`) or moved.

const violations = guards.createViolationRecorder()

// Guard-test seam: test/guardSmall.test.ts triggers violations on purpose.
export const takeSmallGuardViolations = () => violations.take()

setOutboundSocketPolicy('strict')

// Every filesystem write is forbidden; reads are allowed only under
// node_modules, so Vitest's own internals keep working while test code
// cannot read fixtures, snapshots or config files.
const isNodeModules = (resolved: string): boolean =>
  resolved.includes('/node_modules/') || resolved.endsWith('/node_modules')
guards.guardBuiltins(violations, 'small', () => false, isNodeModules)

// A real timer of 100ms or more is a real wait: throw when it is armed while a
// test runs. Fake timers are unaffected (vi.useFakeTimers replaces
// globalThis.setTimeout, bypassing this wrapper); next/dynamic's loading
// delay is exempt, as in vitest.setup.ts's guard.
const LONG_TIMER_MS = 100
const nativeSetTimeout = globalThis.setTimeout
let guardingTimers = false
const guardedSetTimeout = ((...args: Parameters<typeof setTimeout>) => {
  const [handler, delay] = args
  if (
    guardingTimers &&
    typeof handler === 'function' &&
    (delay ?? 0) >= LONG_TIMER_MS
  ) {
    const stack = guards.captureStack()
    if (!/loadable\.shared-runtime/.test(stack)) {
      violations.record('long-timer', `${delay}ms`)
      throw new Error(
        `A real setTimeout of ${delay}ms is blocked in small tests — use fake timers (vi.useFakeTimers()), shorten the delay, or tag the file \`@vitest-size medium\`.`
      )
    }
  }
  return nativeSetTimeout(...args)
}) as typeof setTimeout
Object.defineProperty(guardedSetTimeout, promisify.custom, {
  value: Reflect.get(nativeSetTimeout, promisify.custom)
})
globalThis.setTimeout = guardedSetTimeout

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
