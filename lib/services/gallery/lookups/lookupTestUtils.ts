import { Readable } from 'node:stream'
import { vi } from 'vitest'

import { Database } from '@/lib/database/types'
import {
  SafeRemoteFetchTransport,
  SafeRemoteFetchTransportRequest,
  createSafeRemoteFetch
} from '@/lib/utils/safeRemoteFetch'

import { LookupProvider } from './lookupRequest'
import { createCircuitBreaker, createLimiter } from './rateLimit'

// Test helpers for the lookup modules. They keep every test off the network:
// the transport is a stub behind the real createSafeRemoteFetch, so the URL
// rules, timeouts and body cap still run.

// An in-memory stand-in for the database methods the lookup cache uses.
interface GalleryLookupRecord {
  kind: string
  key: string
  outcome: 'ok' | 'miss' | 'error'
  value: unknown
  fetchedAt: number
  expiresAt: number
}

export const createFakeLookupDatabase = () => {
  const rows = new Map<string, GalleryLookupRecord>()
  const spies = {
    getGalleryLookup: vi.fn(
      async ({ kind, key }: { kind: string; key: string }) =>
        rows.get(`${kind}:${key}`) ?? null
    ),
    putGalleryLookup: vi.fn(
      async ({
        kind,
        key,
        outcome,
        value,
        ttlMs
      }: {
        kind: string
        key: string
        outcome: GalleryLookupRecord['outcome']
        value: unknown
        ttlMs: number
      }) => {
        rows.set(`${kind}:${key}`, {
          kind,
          key,
          outcome,
          value,
          fetchedAt: Date.now(),
          expiresAt: Date.now() + ttlMs
        })
      }
    )
  }
  return { database: spies as unknown as Database, rows, spies }
}

export interface StubResponse {
  statusCode?: number
  body?: unknown
  headers?: Record<string, string>
}

export type StubHandler = (
  request: SafeRemoteFetchTransportRequest
) => StubResponse | Error

// A fetch that serves `handler`'s answer through the real safe-fetch pipeline.
export const createStubFetch = (handler: StubHandler) => {
  const requests: SafeRemoteFetchTransportRequest[] = []
  const transport: SafeRemoteFetchTransport = async (request) => {
    requests.push(request)
    const answer = handler(request)
    if (answer instanceof Error) throw answer
    const body =
      typeof answer.body === 'string'
        ? answer.body
        : answer.body === undefined
          ? ''
          : JSON.stringify(answer.body)
    return {
      body: Readable.from([Buffer.from(body)]),
      headers: answer.headers ?? {},
      statusCode: answer.statusCode ?? 200
    }
  }
  const fetch = createSafeRemoteFetch({
    resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
    transport
  })
  return { fetch, requests }
}

export const createTestProvider = (
  overrides: Partial<LookupProvider> = {}
): LookupProvider => ({
  name: 'Test',
  limiter: createLimiter({ maxConcurrent: 4, minIntervalMs: 0 }),
  breaker: createCircuitBreaker(),
  timeoutMs: 5_000,
  connectTimeoutMs: 2_000,
  maxBodyBytes: 256 * 1024,
  ...overrides
})
