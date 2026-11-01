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
  // Structured parts of the target (e.g. host/port for a socket), recorded at
  // the source instead of re-parsed from `target` later.
  detail?: Record<string, unknown>
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
    record(kind: string, target: string, detail?: Record<string, unknown>) {
      const violation = { kind, target, stack: captureStack(), detail }
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

// Single-target writes: the first argument is the only path judged.
const WRITES =
  'writeFile writeFileSync appendFile appendFileSync mkdir mkdirSync mkdtemp mkdtempSync rm rmSync rmdir rmdirSync unlink unlinkSync createWriteStream truncate truncateSync'.split(
    ' '
  )
// rename moves the file, so both the source and the destination are judged:
// a rename into the allowed roots from outside them deletes a file outside.
const MOVE_WRITES = 'rename renameSync'.split(' ')
// Copies and links only read their source, so just the destination is judged.
// These are guardrails, not a sandbox: a symlink or link created inside the
// allowed roots can still point outside them.
const DEST_WRITES =
  'copyFile copyFileSync cp cpSync symlink symlinkSync link linkSync'.split(' ')
const READS =
  'readFile readFileSync readdir readdirSync createReadStream'.split(' ')
const SPAWNERS =
  'spawn spawnSync exec execSync execFile execFileSync fork'.split(' ')

// fs.open/openSync/fs.promises.open are judged by their flag: a read-only
// flag ('r', 'rs', 'sr') counts as a read, every other flag can write. An
// unrecognisable flag is treated as a write, so it stays blocked.
const READ_FLAGS = /^(?:r|rs|sr)$/
const flagOf = (value: unknown): string | undefined => {
  if (value === undefined) return 'r'
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && 'flag' in value) {
    const flag = (value as { flag?: unknown }).flag
    return typeof flag === 'string' ? flag : undefined
  }
  return undefined
}

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
//
// These wrappers are guardrails that fail the offending test, not a sandbox:
// a symlink created inside the allowed roots can point outside them, and a
// path that only exists later is judged by its literal spelling.
export const guardBuiltins = (
  recorder: ViolationRecorder,
  size: 'small' | 'medium',
  writeAllowed: (resolved: string) => boolean,
  readAllowed?: (resolved: string) => boolean
): void => {
  const blocked = (name: string, target: string, kind: string): Error => {
    recorder.record(kind, target)
    return new Error(
      `${name}(${target}) is blocked in ${size} tests — tag the file \`@vitest-size ${size === 'small' ? 'medium' : 'large'}\``
    )
  }

  const wrap = (
    object: unknown,
    names: readonly string[],
    kind: string,
    allowed?: (resolved: string) => boolean,
    argIndexes: readonly number[] = [0]
  ) => {
    const owner = object as Record<string, unknown>
    for (const name of names) {
      const original = owner[name]
      if (typeof original !== 'function') continue
      owner[name] = function (this: unknown, ...args: unknown[]) {
        const raws = argIndexes.map((index) => asPath(args[index]))
        if (
          raws.every(
            (raw) => raw !== undefined && allowed?.(path.resolve(raw)) === true
          )
        ) {
          return (original as (...args: unknown[]) => unknown).apply(this, args)
        }
        const target =
          raws[0] === undefined
            ? String(args[argIndexes[0]])
            : raws.filter((raw) => raw !== undefined).join(' -> ')
        const error = blocked(name, target, kind)
        // A promise-returning original must fail with a rejected promise, not
        // a synchronous throw: callers that await it (including Node's own
        // recursive rm) would otherwise leave the await pending forever.
        if (original.constructor.name === 'AsyncFunction')
          return Promise.reject(error)
        throw error
      }
    }
  }

  // fs.open and friends: the flag decides whether the call is judged as a
  // read or a write. Reads are allowed when this size does not guard reads
  // (readAllowed undefined); writes always go through writeAllowed.
  const wrapOpen = (object: unknown) => {
    const owner = object as Record<string, unknown>
    for (const name of ['open', 'openSync']) {
      const original = owner[name]
      if (typeof original !== 'function') continue
      owner[name] = function (this: unknown, ...args: unknown[]) {
        const raw = asPath(args[0])
        const flag = flagOf(args[1])
        const writing = flag === undefined || !READ_FLAGS.test(flag)
        const allowed = writing ? writeAllowed : readAllowed
        if (
          raw !== undefined &&
          (allowed === undefined || allowed(path.resolve(raw)) === true)
        ) {
          return (original as (...args: unknown[]) => unknown).apply(this, args)
        }
        const target = raw ?? String(args[0])
        const error = blocked(name, target, writing ? 'fs-write' : 'fs-read')
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
    wrap(object, MOVE_WRITES, 'fs-write', writeAllowed, [0, 1])
    wrap(object, DEST_WRITES, 'fs-write', writeAllowed, [1])
    if (readAllowed !== undefined) wrap(object, READS, 'fs-read', readAllowed)
    wrapOpen(object)
  }
  wrap(childProcess, SPAWNERS, 'child-process')
  syncBuiltinESMExports()
}
