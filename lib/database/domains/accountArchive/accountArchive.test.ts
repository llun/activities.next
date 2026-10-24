import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { seedDatabase } from '@/lib/stub/database'

describe('account archive queries', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  let accountId: string
  let otherAccountId: string

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    await seedDatabase(database)
    accountId = (await database.getActorFromEmail({
      email: 'test1@llun.test'
    }))!.account!.id
    otherAccountId = (await database.getActorFromEmail({
      email: 'test2@llun.test'
    }))!.account!.id
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  const options = { stripExactLocations: true, drafts: false }

  it('creates a queued archive and reads it back', async () => {
    const created = await database.createAccountArchive({
      id: 'archive-1',
      accountId,
      options
    })
    expect(created).toMatchObject({
      id: 'archive-1',
      accountId,
      status: 'queued',
      options,
      progress: null,
      storagePath: null,
      bytes: null,
      readyAt: null,
      expiresAt: null
    })
    expect(created.createdAt).toBeGreaterThan(0)
    expect(await database.getAccountArchive({ id: 'archive-1' })).toEqual(
      created
    )
    expect(await database.getAccountArchive({ id: 'missing' })).toBeNull()
  })

  it('allows only one queued or running archive per account', async () => {
    await expect(
      database.createAccountArchive({ id: 'archive-2', accountId, options })
    ).rejects.toThrow()
    // Another account is unaffected.
    await database.createAccountArchive({
      id: 'archive-other',
      accountId: otherAccountId,
      options
    })
    expect((await database.getActiveAccountArchive({ accountId }))?.id).toBe(
      'archive-1'
    )
  })

  it('updates conditionally and records the finished file', async () => {
    const running = await database.updateAccountArchive({
      id: 'archive-1',
      onlyIfStatus: ['queued', 'running'],
      status: 'running',
      progress: '{"phase":"collect"}'
    })
    expect(running).toMatchObject({
      status: 'running',
      progress: '{"phase":"collect"}'
    })

    const readyAt = Date.now()
    const expiresAt = readyAt + 7 * 24 * 60 * 60 * 1000
    const ready = await database.updateAccountArchive({
      id: 'archive-1',
      status: 'ready',
      storagePath: 'archives/archive-1.zip',
      bytes: 5_000_000_000,
      readyAt,
      expiresAt
    })
    expect(ready).toMatchObject({
      status: 'ready',
      storagePath: 'archives/archive-1.zip',
      bytes: 5_000_000_000,
      readyAt,
      expiresAt
    })

    // A ready archive no longer matches the guard, so a late slice cannot
    // flip it back.
    expect(
      await database.updateAccountArchive({
        id: 'archive-1',
        onlyIfStatus: ['queued', 'running'],
        status: 'running'
      })
    ).toBeNull()
    expect(await database.getActiveAccountArchive({ accountId })).toBeNull()
  })

  it('lets a new archive start once the previous one finished', async () => {
    await database.createAccountArchive({ id: 'archive-3', accountId, options })
    const archives = await database.getAccountArchivesForAccount({
      accountId,
      limit: 10
    })
    expect(archives.map((archive) => archive.id)).toEqual([
      'archive-3',
      'archive-1'
    ])
    expect(
      (await database.getAccountArchivesForAccount({ accountId, limit: 1 }))
        .length
    ).toBe(1)
  })

  it('does not count a failed archive against the request limit', async () => {
    await database.updateAccountArchive({
      id: 'archive-3',
      status: 'failed',
      error: 'boom'
    })
    const latest = await database.getLatestRequestedAccountArchive({
      accountId
    })
    expect(latest?.id).toBe('archive-1')
  })

  it('finds ready archives whose expiry has passed', async () => {
    const future = await database.getExpiredAccountArchives({
      now: Date.now(),
      limit: 10
    })
    expect(future).toEqual([])
    const expired = await database.getExpiredAccountArchives({
      now: Date.now() + 8 * 24 * 60 * 60 * 1000,
      limit: 10
    })
    expect(expired.map((archive) => archive.id)).toEqual(['archive-1'])
  })

  it('has a secret storage token, a heartbeat and a reap counter of its own', async () => {
    const row = (await database.getAccountArchive({ id: 'archive-other' }))!
    expect(row.storageToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(row.reapCount).toBe(0)
    expect(row.heartbeatAt).toBeGreaterThan(0)
    const mine = (await database.getAccountArchive({ id: 'archive-1' }))!
    expect(mine.storageToken).not.toBe(row.storageToken)
  })

  it('moves the heartbeat on every progress save and only compares on the reap count', async () => {
    const before = (await database.getAccountArchive({ id: 'archive-other' }))!
    await new Promise((resolve) => setTimeout(resolve, 5))
    const saved = (await database.updateAccountArchive({
      id: 'archive-other',
      progress: '{"x":1}'
    }))!
    expect(saved.heartbeatAt).toBeGreaterThan(before.heartbeatAt)

    expect(
      await database.updateAccountArchive({
        id: 'archive-other',
        onlyIfReapCount: 3,
        reapCount: 4
      })
    ).toBeNull()
    expect(
      (await database.updateAccountArchive({
        id: 'archive-other',
        onlyIfReapCount: 0,
        reapCount: 1
      }))!.reapCount
    ).toBe(1)
  })

  it('lists unfinished archives by the oldest heartbeat first', async () => {
    await database.updateAccountArchive({
      id: 'archive-1',
      status: 'running',
      heartbeatAt: Date.now() - 5000
    })
    await database.updateAccountArchive({
      id: 'archive-other',
      status: 'running',
      heartbeatAt: Date.now() - 9000
    })
    const stale = await database.getStaleAccountArchives({
      before: Date.now() - 1000,
      limit: 10
    })
    expect(stale.map((archive) => archive.id)).toEqual([
      'archive-other',
      'archive-1'
    ])
    expect(
      await database.getStaleAccountArchives({
        before: Date.now() - 7000,
        limit: 10
      })
    ).toHaveLength(1)
  })

  it('deletes every archive of an account', async () => {
    await database.deleteAccountArchivesForAccount({ accountId })
    expect(
      await database.getAccountArchivesForAccount({ accountId, limit: 10 })
    ).toEqual([])
    expect(
      await database.getAccountArchive({ id: 'archive-other' })
    ).not.toBeNull()
  })
})
