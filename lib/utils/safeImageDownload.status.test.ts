/** @vitest-size medium */
import { readFileSync } from 'node:fs'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { safeImageFetch } from './safeImageDownload'

// A real HTTPS server, because the bug this pins lives in the response
// listener: `new Response(...)` throws for a status outside 200..599, and that
// throw used to escape after the error listener had been detached, leaving
// `safeImageFetch` pending forever — past the per-hop timeout and any caller
// deadline. A mocked stream would exercise the same listener, but a real
// server also proves the real `got` response path reaches it.
//
// The guard requires HTTPS and a public address, so the address policy is
// relaxed for the loopback the server actually listens on (the URL names the
// literal, so no DNS lookup happens). The transport is the real `got`, with
// only the test-only self-signed certificate accepted.
const fixtureDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__fixtures__/pinnedLookup'
)
const cert = readFileSync(path.join(fixtureDir, 'cert.pem'))
const key = readFileSync(path.join(fixtureDir, 'key.pem'))

vi.mock('@/lib/utils/unsafeAddress', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/utils/unsafeAddress')>()
  return { ...actual, isUnsafeAddress: () => false }
})

vi.mock('got', async () => {
  const actual = await vi.importActual<typeof import('got')>('got')
  return {
    __esModule: true,
    default: {
      stream: (url: string, options: Record<string, unknown>) =>
        actual.default.stream(url, {
          ...options,
          https: { rejectUnauthorized: false }
        })
    }
  }
})

describe('safeImageFetch with a status Response cannot represent', () => {
  let server: https.Server
  let port: number

  beforeAll(async () => {
    server = https.createServer({ cert, key }, (_request, response) => {
      // Node accepts 100..999 here; `Response` accepts only 200..599.
      response.statusCode = 999
      response.end('not a real status')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('rejects instead of hanging when the server answers 999', async () => {
    await expect(
      safeImageFetch(`https://127.0.0.1:${port}/photo.jpg`, { timeoutMs: 2000 })
    ).rejects.toThrow('Unexpected HTTP status 999')
  })
})
