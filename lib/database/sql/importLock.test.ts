import { getTestSQLDatabase } from '@/lib/database/testUtils'

describe('ImportLock', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('acquires a free lock and blocks a second acquirer until released', async () => {
    const first = await database.acquireImportLock({
      lockKey: 'actor-a',
      ttlMs: 60_000
    })
    expect(first).not.toBeNull()

    const second = await database.acquireImportLock({
      lockKey: 'actor-a',
      ttlMs: 60_000
    })
    expect(second).toBeNull()

    const released = await database.releaseImportLock({
      lockKey: 'actor-a',
      token: first!.token
    })
    expect(released).toBe(true)

    const third = await database.acquireImportLock({
      lockKey: 'actor-a',
      ttlMs: 60_000
    })
    expect(third).not.toBeNull()
    await database.releaseImportLock({
      lockKey: 'actor-a',
      token: third!.token
    })
  })

  it('steals a lock whose TTL has expired', async () => {
    const now = 1_000_000
    const stale = await database.acquireImportLock({
      lockKey: 'actor-b',
      ttlMs: 1_000,
      now
    })
    expect(stale).not.toBeNull()

    const fresh = await database.acquireImportLock({
      lockKey: 'actor-b',
      ttlMs: 1_000,
      now: now + 5_000
    })
    expect(fresh).not.toBeNull()
    expect(fresh!.token).not.toBe(stale!.token)

    // The original (now superseded) holder can no longer release the lock.
    const staleRelease = await database.releaseImportLock({
      lockKey: 'actor-b',
      token: stale!.token
    })
    expect(staleRelease).toBe(false)

    await database.releaseImportLock({
      lockKey: 'actor-b',
      token: fresh!.token
    })
  })

  it('does not release a lock held under a different token', async () => {
    const lock = await database.acquireImportLock({
      lockKey: 'actor-c',
      ttlMs: 60_000
    })
    expect(lock).not.toBeNull()

    const released = await database.releaseImportLock({
      lockKey: 'actor-c',
      token: 'someone-elses-token'
    })
    expect(released).toBe(false)

    // The lock is still held by the real owner.
    const blocked = await database.acquireImportLock({
      lockKey: 'actor-c',
      ttlMs: 60_000
    })
    expect(blocked).toBeNull()

    await database.releaseImportLock({
      lockKey: 'actor-c',
      token: lock!.token
    })
  })

  it('keeps locks for different keys independent', async () => {
    const a = await database.acquireImportLock({
      lockKey: 'actor-d',
      ttlMs: 60_000
    })
    const b = await database.acquireImportLock({
      lockKey: 'actor-e',
      ttlMs: 60_000
    })
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()

    await database.releaseImportLock({ lockKey: 'actor-d', token: a!.token })
    await database.releaseImportLock({ lockKey: 'actor-e', token: b!.token })
  })
})
