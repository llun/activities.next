import net from 'node:net'
import { afterAll, beforeEach, onTestFinished } from 'vitest'

// The suite must never open a real outbound connection: fetch defaults to the
// real implementation (fetchMock.dontMock()) and the `got` mock calls global
// fetch, so an un-stubbed test would send live signed HTTPS traffic. undici's
// fetch, tls.connect, http2.connect and got all funnel into net.Socket#connect,
// so one patch here blocks every path before a DNS query is even made.
//
// The thrown error alone is not enough — production code often catches
// connection errors — so each violation is recorded and fails its test in
// onTestFinished (same pattern as the timer guard in vitest.setup.ts), naming
// the host and the stack that armed the connection. A violation outside a
// running test (at import, or in a hook) fails the file in afterAll.

export interface OutboundViolation {
  host: string | undefined
  port: number | undefined
  stack: string
}

const testViolations: OutboundViolation[] = []
const outsideViolations: OutboundViolation[] = []
let insideTest = false

const describeViolations = (violations: OutboundViolation[]) =>
  violations
    .map((violation) => {
      const target = violation.host
        ? `${violation.host}:${violation.port ?? '?'}`
        : `port ${violation.port ?? '?'}`
      return `- ${target}, armed at ${violation.stack}`
    })
    .join('\n')

// Guard-test seam: the tests in test/blockOutboundNetwork.test.ts trigger
// violations on purpose and consume them here, so onTestFinished has nothing
// left to fail them for.
export const takeOutboundViolations = (): OutboundViolation[] => {
  const taken = [...testViolations]
  testViolations.length = 0
  return taken
}

export const waitForOutboundViolation = async (
  host: string,
  timeoutMs = 2000
): Promise<OutboundViolation[]> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = testViolations.filter((violation) => violation.host === host)
    if (found.length > 0) {
      testViolations.length = 0
      return found
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `No outbound network violation was recorded for ${host} within ${timeoutMs}ms — the trap did not fire`
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const isAllowedHost = (host: string): boolean =>
  host === 'localhost' ||
  host === '::1' ||
  /^127(?:\.\d{1,3}){3}$/.test(host) ||
  (process.env.TEST_DATABASE_HOST !== undefined &&
    host === process.env.TEST_DATABASE_HOST)

const captureStack = () => {
  const stackTraceLimit = Error.stackTraceLimit
  try {
    Error.stackTraceLimit = 50
    return new Error().stack ?? ''
  } finally {
    Error.stackTraceLimit = stackTraceLimit
  }
}

const recordViolation = (violation: OutboundViolation) => {
  if (insideTest) {
    testViolations.push(violation)
  } else {
    outsideViolations.push(violation)
  }
}

const nativeConnect = net.Socket.prototype.connect

// net.Socket#connect accepts (options[, listener]), (path[, listener]) and
// (port[, host][, listener]); normalise the shapes before judging them.
// net.connect() hands the method an already-normalised arguments array
// ([options, listener]) as a single argument instead of spreading it, so
// unwrap that too.
net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
  const [outerFirst, outerSecond] = args
  const normalized = Array.isArray(outerFirst)
  const first = normalized ? outerFirst[0] : outerFirst
  const second = normalized ? outerFirst[1] : outerSecond
  let path: string | undefined
  let host: string | undefined
  let port: number | undefined
  if (typeof first === 'string') {
    path = first
  } else if (first !== null && typeof first === 'object') {
    const options = first as { path?: unknown; host?: unknown; port?: unknown }
    if (typeof options.path === 'string') path = options.path
    if (typeof options.host === 'string') host = options.host
    if (typeof options.port === 'number') port = options.port
  } else if (typeof first === 'number') {
    port = first
    if (typeof second === 'string') host = second
  }

  // Unix/IPC sockets never leave the machine, and connect() without a host
  // targets localhost; neither can reach a live third party.
  if (path !== undefined || host === undefined || isAllowedHost(host)) {
    return nativeConnect.apply(
      this,
      args as Parameters<typeof nativeConnect>
    ) as ReturnType<typeof net.Socket.prototype.connect>
  }

  const violation: OutboundViolation = { host, port, stack: captureStack() }
  recordViolation(violation)
  throw new Error(
    `Outbound network connection to ${host}:${port ?? '?'} is blocked in tests — stub the request instead (fetchMock.doMock()/mockResponse*, or vi.mock the module making it).`
  )
} as typeof net.Socket.prototype.connect

beforeEach(() => {
  testViolations.length = 0
  insideTest = true
  // onTestFinished runs after every afterEach hook, so a violation a test (or
  // the code it drove) swallowed still fails that test, with the arming stack.
  onTestFinished(() => {
    insideTest = false
    if (testViolations.length === 0) return
    const leaked = [...testViolations]
    testViolations.length = 0
    throw new Error(
      `${leaked.length} outbound network connection(s) attempted during the test — stub them (fetchMock or vi.mock):\n` +
        describeViolations(leaked)
    )
  })
})

afterAll(() => {
  const leaked = [...outsideViolations, ...testViolations]
  outsideViolations.length = 0
  testViolations.length = 0
  if (leaked.length === 0) return
  throw new Error(
    `${leaked.length} outbound network connection(s) attempted outside a running test (at import, or in a hook) — stub them (fetchMock or vi.mock):\n` +
      describeViolations(leaked)
  )
})
