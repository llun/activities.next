import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { seedDatabase } from '@/lib/stub/database'

describe('account import queries', () => {
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

  it('creates a queued import and reads it back', async () => {
    const created = await database.createAccountImport({
      id: 'import-1',
      accountId,
      actorId: 'actor-1',
      options: '{"likes":false}'
    })
    expect(created).toMatchObject({
      id: 'import-1',
      accountId,
      actorId: 'actor-1',
      status: 'queued',
      options: '{"likes":false}',
      kind: null,
      progress: null,
      phase: null,
      cursor: null,
      runToken: null,
      claimedUntil: null,
      lastErrorCode: null,
      uploadedBytes: 0
    })
    expect(created.createdAt).toBeGreaterThan(0)
    expect(
      await database.getAccountImport({ id: 'import-1', actorId: 'actor-1' })
    ).toMatchObject({ id: 'import-1' })
    // Another actor does not see it.
    expect(
      await database.getAccountImport({ id: 'import-1', actorId: 'actor-2' })
    ).toBeNull()
  })

  it('allows only one active import per actor and lists them newest first', async () => {
    await expect(
      database.createAccountImport({
        id: 'import-2',
        accountId,
        actorId: 'actor-1',
        options: '{}'
      })
    ).rejects.toThrow()
    await database.updateAccountImport({
      id: 'import-1',
      status: 'cancelled'
    })
    const second = await database.createAccountImport({
      id: 'import-3',
      accountId,
      actorId: 'actor-1',
      options: '{}'
    })
    expect(second.status).toBe('queued')
    const imports = await database.listAccountImports({
      actorId: 'actor-1',
      limit: 10
    })
    expect(imports.map((row) => row.id)).toEqual(['import-3', 'import-1'])
    // A different actor is unaffected by actor-1's active import.
    const otherActorImport = await database.createAccountImport({
      id: 'import-other',
      accountId: otherAccountId,
      actorId: 'actor-2',
      options: '{}'
    })
    expect(otherActorImport.status).toBe('queued')
  })

  it('claims a run lease and refuses a second claim while it holds', async () => {
    const first = await database.claimAccountImportRun({
      id: 'import-3',
      runToken: 'token-a',
      leaseMs: 60_000
    })
    expect(first).toEqual({ claimed: true })

    const second = await database.claimAccountImportRun({
      id: 'import-3',
      runToken: 'token-b',
      leaseMs: 60_000
    })
    expect(second.claimed).toBe(false)

    // A lapsed lease may be taken by another run.
    await database.updateAccountImport({
      id: 'import-3',
      claimedUntil: Date.now() - 1000
    })
    const third = await database.claimAccountImportRun({
      id: 'import-3',
      runToken: 'token-b',
      leaseMs: 60_000
    })
    expect(third).toEqual({ claimed: true })
    await database.releaseAccountImportRun({
      id: 'import-3',
      runToken: 'token-b'
    })
    const released = await database.getAccountImport({
      id: 'import-3',
      actorId: 'actor-1'
    })
    expect(released?.runToken).toBeNull()
    expect(released?.claimedUntil).toBeNull()
  })

  it('renews a lease only for the run that holds it', async () => {
    await database.createAccountImport({
      id: 'import-lease',
      accountId,
      actorId: 'actor-lease',
      options: '{}'
    })
    expect(
      await database.renewAccountImportRun({
        id: 'import-lease',
        runToken: 'wrong',
        leaseMs: 60_000
      })
    ).toBe(false)
    expect(
      await database.renewAccountImportRun({
        id: 'import-lease',
        runToken: 'token-b',
        leaseMs: 60_000
      })
    ).toBe(false)
    await database.claimAccountImportRun({
      id: 'import-lease',
      runToken: 'token-a',
      leaseMs: 60_000
    })
    expect(
      await database.renewAccountImportRun({
        id: 'import-lease',
        runToken: 'token-a',
        leaseMs: 120_000
      })
    ).toBe(true)
  })

  it('upserts items and ignores duplicates on the unique key', async () => {
    await database.upsertAccountImportItems({
      importId: 'import-1',
      actorId: 'actor-1',
      items: [
        { kind: 'status', sourceId: 'source-1', position: 0 },
        { kind: 'status', sourceId: 'source-2', position: 1 }
      ]
    })
    // The same actor/kind/source pair again: ignored, not duplicated.
    await database.upsertAccountImportItems({
      importId: 'import-1',
      actorId: 'actor-1',
      items: [{ kind: 'status', sourceId: 'source-1', position: 0 }]
    })
    const items = await database.getAccountImportItems({
      importId: 'import-1',
      limit: 10
    })
    expect(items.map((item) => item.sourceId)).toEqual(['source-1', 'source-2'])
  })

  it('pages pending items by position and marks them', async () => {
    await database.createAccountImport({
      id: 'import-items',
      accountId,
      actorId: 'actor-items',
      options: '{}'
    })
    await database.upsertAccountImportItems({
      importId: 'import-items',
      actorId: 'actor-1',
      items: [
        { kind: 'status', sourceId: 'a', position: 0 },
        { kind: 'status', sourceId: 'b', position: 1 }
      ]
    })
    expect(
      (
        await database.getAccountImportItems({
          importId: 'import-items',
          limit: 10
        })
      ).map((item) => item.sourceId)
    ).toEqual(['a', 'b'])
    expect(
      (
        await database.getAccountImportItems({
          importId: 'import-items',
          afterPosition: 0,
          limit: 10
        })
      ).map((item) => item.sourceId)
    ).toEqual(['b'])
    expect(
      await database.markAccountImportItem({
        id: (
          await database.getAccountImportItems({
            importId: 'import-items',
            limit: 1
          })
        )[0].id,
        state: 'done',
        targetId: 'status-1'
      })
    ).toBe(true)
  })

  it('resets retryable items back to pending for a list of reasons', async () => {
    await database.createAccountImport({
      id: 'import-retry',
      accountId,
      actorId: 'actor-retry',
      options: '{}'
    })
    await database.upsertAccountImportItems({
      importId: 'import-retry',
      actorId: 'actor-1',
      items: [
        { kind: 'status', sourceId: 'r1', position: 0 },
        { kind: 'status', sourceId: 'r2', position: 1 }
      ]
    })
    await database.markAccountImportItem({
      id: (
        await database.getAccountImportItems({
          importId: 'import-retry',
          limit: 1
        })
      )[0].id,
      state: 'failed',
      reason: 'transient'
    })
    expect(
      await database.resetRetryableAccountImportItems({
        importId: 'import-retry',
        reasons: ['transient']
      })
    ).toBe(1)
    expect(
      await database.resetRetryableAccountImportItems({
        importId: 'import-retry',
        reasons: ['transient']
      })
    ).toBe(0)
  })

  it('deletes every import of an actor', async () => {
    await database.deleteAccountImportsForActor({ actorId: 'actor-1' })
    expect(
      await database.listAccountImports({ actorId: 'actor-1', limit: 10 })
    ).toEqual([])
    expect(
      await database.countAccountImportStartsSince({
        actorId: 'actor-1',
        since: 0
      })
    ).toBe(0)
  })

  it('counts starts since a point in time', async () => {
    await database.createAccountImport({
      id: 'import-count',
      accountId,
      actorId: 'actor-count',
      options: '{}'
    })
    expect(
      await database.countAccountImportStartsSince({
        actorId: 'actor-count',
        since: 0
      })
    ).toBeGreaterThanOrEqual(1)
  })
})
