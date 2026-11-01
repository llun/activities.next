import net from 'node:net'

import { createViolationRecorder } from './guardViolations'

// The suite must never open a real outbound connection: fetch defaults to the
// real implementation (fetchMock.dontMock()) and the `got` mock calls global
// fetch, so an un-stubbed test would send live signed HTTPS traffic. undici's
// fetch, tls.connect, http2.connect and got all funnel into net.Socket#connect,
// so one patch here blocks every path before a DNS query is even made.
//
// Recording and the swallowed-error handling live in guardViolations.ts; this
// file installs the socket patch and maps its violations to host/port.

export interface OutboundViolation {
  host: string | undefined
  port: number | undefined
  stack: string
}

const violations = createViolationRecorder()

// Guard-test seam: the tests in test/blockOutboundNetwork.test.ts trigger
// violations on purpose and consume them here, so onTestFinished has nothing
// left to fail them for.
export const takeOutboundViolations = (): OutboundViolation[] =>
  violations.take().map((violation) => {
    const [hostPart, portPart] = violation.target.split(':')
    return {
      host: hostPart === '' ? undefined : hostPart,
      port: portPart === undefined ? undefined : Number(portPart),
      stack: violation.stack
    }
  })

export const waitForOutboundViolation = async (
  host: string,
  timeoutMs = 2000
): Promise<OutboundViolation[]> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = takeOutboundViolations().filter(
      (violation) => violation.host === host
    )
    if (found.length > 0) return found
    if (Date.now() >= deadline) {
      throw new Error(
        `No outbound-network violation was recorded for ${host} within ${timeoutMs}ms — the trap did not fire`
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

// 'base' (default): unix sockets and loopback are allowed — they can never
// reach a live third party. 'strict' (small tests): every connect is blocked,
// including loopback and unix sockets, because a small test must not wait on
// any socket at all. test/setup/guardSmall.ts flips this on.
export type OutboundSocketPolicy = 'base' | 'strict'
let socketPolicy: OutboundSocketPolicy = 'base'
export const setOutboundSocketPolicy = (policy: OutboundSocketPolicy): void => {
  socketPolicy = policy
}

// Node's own isPipeName/toNumber: a string is a unix path only when it isn't a
// non-negative number, so '80' is a port, not a path.
const toNumber = (value: string): number | false => {
  const x = Number(value)
  return x >= 0 ? x : false
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
    const numeric = toNumber(first)
    if (numeric === false) {
      path = first
    } else {
      port = numeric
      if (typeof second === 'string') host = second
    }
  } else if (first !== null && typeof first === 'object') {
    const options = first as { path?: unknown; host?: unknown; port?: unknown }
    // Node decides between unix and TCP with !!path, so '' stays TCP.
    if (typeof options.path === 'string' && options.path) path = options.path
    if (typeof options.host === 'string') host = options.host
    if (typeof options.port === 'number') {
      port = options.port
    } else if (typeof options.port === 'string') {
      const numeric = toNumber(options.port)
      if (numeric !== false) port = numeric
    }
  } else if (typeof first === 'number') {
    port = first
    if (typeof second === 'string') host = second
  }

  const target =
    path !== undefined
      ? `unix socket ${path}`
      : `${host ?? 'localhost'}:${port ?? '?'}`
  const allowed =
    socketPolicy !== 'strict' &&
    (path !== undefined || host === undefined || isAllowedHost(host))
  if (allowed) {
    return nativeConnect.apply(
      this,
      args as Parameters<typeof nativeConnect>
    ) as ReturnType<typeof net.Socket.prototype.connect>
  }

  violations.record('outbound-network', target)
  throw new Error(
    `Outbound network connection to ${target} is blocked in tests — stub the request instead (fetchMock.doMock()/mockResponse*, or vi.mock the module making it).`
  )
} as typeof net.Socket.prototype.connect

violations.installFailHooks('outbound network connection')
