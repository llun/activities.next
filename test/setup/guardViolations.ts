import childProcess from 'node:child_process'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import path from 'node:path'
import { afterAll, beforeEach, onTestFinished } from 'vitest'

// Shared machinery for the test-size guards (guardSmall.ts, guardMedium.ts)
// and the outbound-network trap (blockOutboundNetwork.ts). A blocked call
// records a violation with the stack that armed it, then throws; the throw
// alone is not enough because production code often catches errors. The
// recorder fails the test afterwards in onTestFinished (which runs after every
// afterEach hook), so a swallowed throw still fails the test, and fails the
// file in afterAll when the violation happened outside a running test.

export interface GuardViolation {
  kind: string
  target: string
  stack: string
}

export const captureStack = (): string => {
  const limit = Error.stackTraceLimit
  try {
    Error.stackTraceLimit = 50
    return new Error().stack ?? ''
  } finally {
    Error.stackTraceLimit = limit
  }
}

export const createViolationRecorder = () => {
  const testViolations: GuardViolation[] = []
  const outsideViolations: GuardViolation[] = []
  let insideTest = false

  const drain = (): GuardViolation[] => {
    const taken = [...testViolations, ...outsideViolations]
    testViolations.length = 0
    outsideViolations.length = 0
    return taken
  }

  const fail = (
    label: string,
    where: string,
    leaked: GuardViolation[]
  ): never => {
    const lines = leaked
      .map((v) => `${v.kind} ${v.target} ${v.stack}`)
      .join('\n')
    throw new Error(
      `${leaked.length} ${label} violation(s) ${where}:\n${lines}`
    )
  }

  return {
    record(kind: string, target: string) {
      const violation = { kind, target, stack: captureStack() }
      ;(insideTest ? testViolations : outsideViolations).push(violation)
    },

    // Guard tests consume recorded violations on purpose, so the fail hooks
    // have nothing left to fail them for.
    take: drain,

    installFailHooks(label: string) {
      beforeEach(() => {
        testViolations.length = 0
        insideTest = true
        onTestFinished(() => {
          insideTest = false
          const leaked = drain()
          if (leaked.length > 0) fail(label, 'during the test', leaked)
        })
      })
      afterAll(() => {
        const leaked = drain()
        if (leaked.length > 0) fail(label, 'outside a running test', leaked)
      })
    }
  }
}

export type ViolationRecorder = ReturnType<typeof createViolationRecorder>

const WRITES =
  'writeFile writeFileSync appendFile appendFileSync mkdir mkdirSync mkdtemp mkdtempSync rm rmSync rmdir rmdirSync unlink unlinkSync rename renameSync createWriteStream'.split(
    ' '
  )
const READS =
  'readFile readFileSync readdir readdirSync createReadStream'.split(' ')
const SPAWNERS =
  'spawn spawnSync exec execSync execFile execFileSync fork'.split(' ')

// Node's own internals pass Buffer paths (fs.promises.rm's recursive rimraf
// hands rmdir a Buffer), so typed arrays are decoded, not treated as
// unrecognisable.
const asPath = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  if (value instanceof URL) return value.pathname
  if (typeof value === 'object' && value !== null && 'buffer' in value) {
    return String(value)
  }
  return undefined
}

// Patch fs and child_process on their CommonJS objects, then
// syncBuiltinESMExports() so named ESM imports of the builtins see the
// wrappers too. `writeAllowed`/`readAllowed` receive the resolved target path
// and return true to allow the call; reads are guarded only when
// `readAllowed` is given. A file descriptor or other unrecognisable target
// cannot be judged, so it is blocked.
export const guardBuiltins = (
  recorder: ViolationRecorder,
  size: 'small' | 'medium',
  writeAllowed: (resolved: string) => boolean,
  readAllowed?: (resolved: string) => boolean
): void => {
  const wrap = (
    object: unknown,
    names: readonly string[],
    kind: string,
    allowed?: (resolved: string) => boolean
  ) => {
    const owner = object as Record<string, unknown>
    for (const name of names) {
      const original = owner[name]
      if (typeof original !== 'function') continue
      owner[name] = function (this: unknown, ...args: unknown[]) {
        const raw = asPath(args[0])
        if (raw !== undefined && allowed?.(path.resolve(raw))) {
          return (original as (...args: unknown[]) => unknown).apply(this, args)
        }
        const target = raw ?? String(args[0])
        recorder.record(kind, target)
        const error = new Error(
          `${name}(${target}) is blocked in ${size} tests — tag the file \`@vitest-size ${size === 'small' ? 'medium' : 'large'}\``
        )
        // A promise-returning original must fail with a rejected promise, not
        // a synchronous throw: callers that await it (including Node's own
        // recursive rm) would otherwise leave the await pending forever.
        if (original.constructor.name === 'AsyncFunction')
          return Promise.reject(error)
        throw error
      }
    }
  }

  // fs.promises and the fs/promises module are the same object: dedupe, or
  // the second pass would wrap the first wrapper (and misjudge promise-ness).
  const objects = [fs, fs.promises, fsPromises].filter(
    (object, index, all) => all.indexOf(object) === index
  )
  for (const object of objects) {
    wrap(object, WRITES, 'fs-write', writeAllowed)
    if (readAllowed !== undefined) wrap(object, READS, 'fs-read', readAllowed)
  }
  wrap(childProcess, SPAWNERS, 'child-process')
  syncBuiltinESMExports()
}
