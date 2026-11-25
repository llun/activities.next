import { NextRequest } from 'next/server'

import { resetTrustProxyIpHeadersConfigCacheForTests } from '@/lib/config/trustProxyIpHeaders'
import { APP_RATE_LIMIT_KEY_PREFIX } from '@/lib/database/domains/rateLimit/types'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  PDS_REPO_READ_ANONYMOUS_RATE_LIMIT,
  PDS_SYNC_ANONYMOUS_RATE_LIMIT,
  PDS_SYNC_BLOB_ANONYMOUS_RATE_LIMIT,
  PDS_SYNC_RATE_LIMIT,
  PDS_SYNC_RATE_LIMIT_WINDOW_MS,
  checkPdsSyncRateLimit
} from '@/lib/services/pds/rateLimit'

describe('PDS sync/repo rate limiting', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  const originalTrustProxyEnv = process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS
  const originalTrustProxyHeaderEnv =
    process.env.ACTIVITIES_TRUST_PROXY_IP_HEADER

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  beforeEach(async () => {
    delete process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS
    delete process.env.ACTIVITIES_TRUST_PROXY_IP_HEADER
    resetTrustProxyIpHeadersConfigCacheForTests()
    await database.deleteRateLimits({ keyPrefix: APP_RATE_LIMIT_KEY_PREFIX })
  })

  afterAll(async () => {
    if (originalTrustProxyEnv === undefined) {
      delete process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS
    } else {
      process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS = originalTrustProxyEnv
    }
    if (originalTrustProxyHeaderEnv === undefined) {
      delete process.env.ACTIVITIES_TRUST_PROXY_IP_HEADER
    } else {
      process.env.ACTIVITIES_TRUST_PROXY_IP_HEADER = originalTrustProxyHeaderEnv
    }
    resetTrustProxyIpHeadersConfigCacheForTests()
    await database.destroy()
  })

  it('applies a coarse shared fallback bucket per endpoint group when no trusted client key is available', async () => {
    const consumeSpy = vi.spyOn(database, 'consumeRateLimit')
    try {
      const req = new NextRequest(
        'https://pds.example.test/xrpc/com.atproto.sync.getRepo',
        { headers: { 'x-forwarded-for': '203.0.113.50' } }
      )

      const syncRes = await checkPdsSyncRateLimit(database, req, 'sync')
      expect(syncRes.allowed).toBe(true)
      expect(consumeSpy).toHaveBeenLastCalledWith({
        key: `${APP_RATE_LIMIT_KEY_PREFIX}pds:sync:anonymous`,
        keyPrefix: APP_RATE_LIMIT_KEY_PREFIX,
        limit: PDS_SYNC_ANONYMOUS_RATE_LIMIT,
        windowMs: PDS_SYNC_RATE_LIMIT_WINDOW_MS
      })

      const blobRes = await checkPdsSyncRateLimit(database, req, 'blob')
      expect(blobRes.allowed).toBe(true)
      expect(consumeSpy).toHaveBeenLastCalledWith({
        key: `${APP_RATE_LIMIT_KEY_PREFIX}pds:blob:anonymous`,
        keyPrefix: APP_RATE_LIMIT_KEY_PREFIX,
        limit: PDS_SYNC_BLOB_ANONYMOUS_RATE_LIMIT,
        windowMs: PDS_SYNC_RATE_LIMIT_WINDOW_MS
      })

      const repoRes = await checkPdsSyncRateLimit(database, req, 'repo')
      expect(repoRes.allowed).toBe(true)
      expect(consumeSpy).toHaveBeenLastCalledWith({
        key: `${APP_RATE_LIMIT_KEY_PREFIX}pds:repo:anonymous`,
        keyPrefix: APP_RATE_LIMIT_KEY_PREFIX,
        limit: PDS_REPO_READ_ANONYMOUS_RATE_LIMIT,
        windowMs: PDS_SYNC_RATE_LIMIT_WINDOW_MS
      })

      // Exhaust the shared anonymous sync bucket (1 already consumed above).
      for (let i = 1; i < PDS_SYNC_ANONYMOUS_RATE_LIMIT; i += 1) {
        const res = await checkPdsSyncRateLimit(database, req, 'sync')
        expect(res.allowed).toBe(true)
      }

      const blocked = await checkPdsSyncRateLimit(database, req, 'sync')
      expect(blocked.allowed).toBe(false)
      expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1)

      // Other endpoint group fallback buckets remain independent.
      expect((await checkPdsSyncRateLimit(database, req, 'repo')).allowed).toBe(
        true
      )
    } finally {
      consumeSpy.mockRestore()
    }
  })

  it('uses per-client hashed buckets when trusted proxy IP headers are enabled', async () => {
    process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS = 'true'
    resetTrustProxyIpHeadersConfigCacheForTests()

    const consumeSpy = vi.spyOn(database, 'consumeRateLimit')
    try {
      const req = new NextRequest(
        'https://pds.example.test/xrpc/com.atproto.sync.getRepo',
        { headers: { 'x-forwarded-for': '203.0.113.55' } }
      )

      const res = await checkPdsSyncRateLimit(database, req, 'sync')
      expect(res.allowed).toBe(true)
      expect(consumeSpy).toHaveBeenCalledWith({
        key: expect.stringMatching(
          new RegExp(`^${APP_RATE_LIMIT_KEY_PREFIX}pds-sync:[0-9a-f]{64}$`)
        ),
        keyPrefix: APP_RATE_LIMIT_KEY_PREFIX,
        limit: PDS_SYNC_RATE_LIMIT,
        windowMs: PDS_SYNC_RATE_LIMIT_WINDOW_MS
      })
    } finally {
      consumeSpy.mockRestore()
    }
  })
})
