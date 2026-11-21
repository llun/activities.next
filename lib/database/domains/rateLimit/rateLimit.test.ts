import { sql } from 'kysely'

import { getSQLDatabase } from '@/lib/database/getSQLDatabase'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

const KEY_PREFIX = 'app:'

describe('rateLimit domain', () => {
  const testDb = createTestDatabase()
  const { database, db } = testDb

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  beforeEach(async () => {
    await sql`DELETE FROM "rateLimit"`.execute(db)
  })

  afterAll(async () => {
    await database.destroy()
  })

  const consume = (
    key: string,
    {
      limit = 3,
      windowMs = 1_000,
      now = 1_000
    }: { limit?: number; windowMs?: number; now?: number } = {}
  ) =>
    database.consumeRateLimit({
      key: `${KEY_PREFIX}test:${key}`,
      keyPrefix: KEY_PREFIX,
      limit,
      windowMs,
      now
    })

  it('admits the limit and refuses the next hit in the same window', async () => {
    expect(await consume('a')).toEqual({ allowed: true, retryAfterSeconds: 0 })
    expect(await consume('a')).toEqual({ allowed: true, retryAfterSeconds: 0 })
    expect(await consume('a')).toEqual({ allowed: true, retryAfterSeconds: 0 })
    expect(await consume('a')).toEqual({
      allowed: false,
      retryAfterSeconds: 1
    })
    // A different key has its own window.
    expect(await consume('b')).toEqual({ allowed: true, retryAfterSeconds: 0 })
  })

  it('starts a fresh window once the previous one has ended', async () => {
    expect(
      await consume('reset', { limit: 1, windowMs: 1_000, now: 1_000 })
    ).toEqual({ allowed: true, retryAfterSeconds: 0 })
    expect(
      await consume('reset', { limit: 1, windowMs: 1_000, now: 1_500 })
    ).toMatchObject({ allowed: false })

    // The window ended at 2_000; the next hit starts a new one.
    expect(
      await consume('reset', { limit: 1, windowMs: 1_000, now: 2_001 })
    ).toEqual({ allowed: true, retryAfterSeconds: 0 })
    expect(
      await consume('reset', { limit: 1, windowMs: 1_000, now: 2_002 })
    ).toMatchObject({ allowed: false })
  })

  it('shares one count between independent database instances', async () => {
    const first = getSQLDatabase(db)
    const second = getSQLDatabase(db)
    const params = {
      key: `${KEY_PREFIX}test:shared`,
      keyPrefix: KEY_PREFIX,
      limit: 3,
      windowMs: 1_000,
      now: 1_000
    }

    expect(await first.consumeRateLimit(params)).toMatchObject({
      allowed: true
    })
    expect(await first.consumeRateLimit(params)).toMatchObject({
      allowed: true
    })
    expect(await second.consumeRateLimit(params)).toMatchObject({
      allowed: true
    })
    // The fourth hit is refused whichever instance sees it.
    expect(await second.consumeRateLimit(params)).toMatchObject({
      allowed: false
    })
    expect(await first.consumeRateLimit(params)).toMatchObject({
      allowed: false
    })
  })

  it('does not lose counts under concurrent increments', async () => {
    const params = {
      key: `${KEY_PREFIX}test:concurrent`,
      keyPrefix: KEY_PREFIX,
      limit: 5,
      windowMs: 1_000,
      now: 1_000
    }
    const results = await Promise.all(
      Array.from({ length: 20 }, () => database.consumeRateLimit(params))
    )
    expect(results.filter((result) => result.allowed)).toHaveLength(5)
    expect(results.filter((result) => !result.allowed)).toHaveLength(15)
  })

  it('deletes only its own expired rows, bounded by the batch size', async () => {
    const now = 10_000
    await db
      .insertInto('rateLimit')
      .values([
        { id: 'app:old', key: 'app:old', count: 1, lastRequest: now - 1 },
        { id: 'app:older', key: 'app:older', count: 1, lastRequest: now - 2 },
        { id: 'app:live', key: 'app:live', count: 1, lastRequest: now + 1 },
        // better-auth's own row: never touched by the app's cleanup.
        { id: 'ip|/ok', key: '203.0.113.1|/ok', count: 1, lastRequest: now - 1 }
      ])
      .execute()

    expect(
      await database.deleteRateLimits({
        keyPrefix: KEY_PREFIX,
        before: now,
        limit: 1
      })
    ).toBe(1)

    const remaining = await db
      .selectFrom('rateLimit')
      .select('key')
      .orderBy('key')
      .execute()
    expect(remaining.map((row) => row.key)).toEqual([
      '203.0.113.1|/ok',
      'app:live',
      'app:old'
    ])

    expect(
      await database.deleteRateLimits({ keyPrefix: KEY_PREFIX, before: now })
    ).toBe(1)
    const after = await db
      .selectFrom('rateLimit')
      .select('key')
      .orderBy('key')
      .execute()
    expect(after.map((row) => row.key)).toEqual(['203.0.113.1|/ok', 'app:live'])
  })
})
