import type { RateLimitDatabase } from '@/lib/database/domains/rateLimit/types'

// A small in-memory stand-in for the `rateLimit` domain, for route tests that
// mock the database facade and only need the counters to behave. The real
// counter is exercised against SQLite and PostgreSQL in
// `lib/database/domains/rateLimit/rateLimit.test.ts`.
export const createInMemoryRateLimitDatabase = (): RateLimitDatabase => {
  const rows = new Map<string, { count: number; lastRequest: number }>()

  return {
    async consumeRateLimit({ key, limit, windowMs, now = Date.now() }) {
      const current = rows.get(key)
      if (!current || current.lastRequest <= now) {
        rows.set(key, { count: 1, lastRequest: now + windowMs })
        return { allowed: true, retryAfterSeconds: 0 }
      }
      if (current.count <= limit) current.count += 1
      const allowed = current.count <= limit
      return {
        allowed,
        retryAfterSeconds: allowed
          ? 0
          : Math.max(1, Math.ceil((current.lastRequest - now) / 1000))
      }
    },
    async deleteRateLimits({ keyPrefix, before, limit }) {
      let deleted = 0
      for (const [key, row] of rows) {
        if (!key.startsWith(keyPrefix)) continue
        if (before !== undefined && row.lastRequest >= before) continue
        if (limit !== undefined && deleted >= limit) break
        rows.delete(key)
        deleted += 1
      }
      return deleted
    }
  }
}
