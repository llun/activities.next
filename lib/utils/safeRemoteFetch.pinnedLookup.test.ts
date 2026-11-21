/** @vitest-size medium */
import { readFileSync } from 'node:fs'
import http2 from 'node:http2'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createSafeRemoteFetch } from './safeRemoteFetch'

// `safeRemoteFetch` resolves a hostname once, checks every answer, and pins the
// result into the connection through `createFixedDnsLookup` so the transport
// cannot resolve the name again (the DNS-rebinding race). The unit tests pin
// that the lookup is handed to `got` with `http2: true`; this one drives the
// real `safeRemoteFetch` against a real HTTP/2 TLS server and proves the
// transport actually consults the pinned lookup.
//
// The URL names `localhost`; the injected resolver pins 127.0.0.1, where the
// server listens. The lookup handed to `got` is wrapped so the test can see it
// being called: a transport that resolved the name itself would never call it.
const fixtureDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__fixtures__/pinnedLookup'
)
const cert = readFileSync(path.join(fixtureDir, 'cert.pem'))
const key = readFileSync(path.join(fixtureDir, 'key.pem'))

const { lookupCalls } = vi.hoisted(() => ({ lookupCalls: [] as string[] }))

// The guard rejects a non-public address, but this test is about the transport
// honouring the pinned lookup, not the address policy (covered elsewhere).
vi.mock('@/lib/utils/unsafeAddress', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/utils/unsafeAddress')>()
  return { ...actual, isUnsafeAddress: () => false }
})

// `got` is mocked globally; use the real one, accepting only the test-only
// self-signed certificate. The `dnsLookup` the transport passes is wrapped so
// the test can observe it, then delegated to unchanged.
vi.mock('got', async () => {
  const actual = await vi.importActual<typeof import('got')>('got')
  return {
    __esModule: true,
    default: {
      stream: (url: string, options: Record<string, unknown>) => {
        const dnsLookup = options.dnsLookup as
          ((...args: unknown[]) => void) | undefined
        const observedLookup = dnsLookup
          ? (...args: unknown[]) => {
              lookupCalls.push(String(args[0]))
              return dnsLookup(...args)
            }
          : undefined
        return actual.default.stream(url, {
          ...options,
          ...(observedLookup ? { dnsLookup: observedLookup } : {}),
          https: { rejectUnauthorized: false }
        })
      }
    }
  }
})

describe('pinned DNS lookup over HTTP/2', () => {
  let server: http2.Http2SecureServer
  let port: number
  const paths: string[] = []
  const sessions = new Set<http2.ServerHttp2Session>()

  beforeAll(async () => {
    server = http2.createSecureServer({ cert, key })
    server.on('session', (session) => {
      sessions.add(session)
      session.once('close', () => sessions.delete(session))
    })
    server.on(
      'stream',
      (stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) => {
        paths.push(String(headers[':path']))
        stream.respond({ ':status': 200, 'content-type': 'text/plain' })
        stream.end('pinned')
      }
    )
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    for (const session of sessions) session.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('connects to the pinned address instead of resolving the name again', async () => {
    const safeRemoteFetch = createSafeRemoteFetch({
      resolveHost: async () => [{ address: '127.0.0.1', family: 4 }]
    })

    const result = await safeRemoteFetch({
      timeoutInMilliseconds: 5000,
      url: `https://localhost:${port}/pinned`
    })

    expect(result.statusCode).toBe(200)
    expect(result.body).toBe('pinned')
    expect(paths).toContain('/pinned')
    // The HTTP/2 transport asked the pinned lookup for `localhost` instead of
    // resolving it itself.
    expect(lookupCalls).toContain('localhost')
  })
})
