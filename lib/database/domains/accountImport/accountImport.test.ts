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
        { kind: 'status', sourceId: 'r1', position: 0, data: '{"v":1}' },
        { kind: 'status', sourceId: 'r2', position: 1, data: '{"v":2}' }
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
      reason: 'transient',
      retryable: true
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
    expect(
      (
        await database.getAccountImportItems({
          importId: 'import-retry',
          limit: 10
        })
      )[0].data
    ).toBe('{"v":1}')
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
    const started = await database.createAccountImport({
      id: 'import-count',
      accountId,
      actorId: 'actor-count',
      options: '{}'
    })
    await testDb.db
      .updateTable('account_imports')
      .set({ startedAt: new Date() })
      .where('id', '=', started.id)
      .execute()
    expect(
      await database.countAccountImportStartsSince({
        actorId: 'actor-count',
        since: 0
      })
    ).toBeGreaterThanOrEqual(1)
  })

  it('counts starts by startedAt and ignores recent uploads that never started', async () => {
    const now = Date.now()
    const since = now - 24 * 60 * 60 * 1000
    const unstarted = await database.createAccountImport({
      id: 'import-unstarted-count',
      accountId,
      actorId: 'actor-unstarted-count',
      options: '{}'
    })
    const started = await database.createAccountImport({
      id: 'import-started-count',
      accountId,
      actorId: 'actor-started-count',
      options: '{}'
    })
    await database.updateAccountImport({
      id: started.id,
      status: 'done'
    })
    await testDb.db
      .updateTable('account_imports')
      .set({
        createdAt: new Date(since - 1000),
        startedAt: new Date(since + 1000)
      })
      .where('id', '=', started.id)
      .execute()

    expect(
      await database.countAccountImportStartsSince({
        actorId: unstarted.actorId,
        since
      })
    ).toBe(0)
    expect(
      await database.countAccountImportStartsSince({
        actorId: started.actorId,
        since
      })
    ).toBe(1)
  })

  it('returns the oldest start in the window for retry timing', async () => {
    const now = Date.now()
    const since = now - 24 * 60 * 60 * 1000
    const accountImport = await database.createAccountImport({
      id: 'import-oldest-start',
      accountId,
      actorId: 'actor-oldest-start',
      options: '{}'
    })
    await testDb.db
      .updateTable('account_imports')
      .set({ startedAt: new Date(since + 10_000) })
      .where('id', '=', accountImport.id)
      .execute()

    expect(
      await database.getOldestAccountImportStartSince({
        actorId: accountImport.actorId,
        since
      })
    ).toBe(since + 10_000)
    expect(
      await database.getOldestAccountImportStartSince({
        actorId: 'actor-without-starts',
        since
      })
    ).toBeNull()
  })

  it('counts all started imports without a scan cap', async () => {
    const now = Date.now()
    const since = now - 24 * 60 * 60 * 1000
    const count = 1005
    const rows = Array.from({ length: count }, (_, index) => ({
      id: `import-start-count-${index}`,
      accountId,
      actorId: 'actor-start-count-many',
      status: 'done',
      options: '{}',
      storageToken: `token-${index}`,
      createdAt: new Date(since - 1000),
      startedAt: new Date(since + 1000),
      updatedAt: new Date(since - 1000)
    }))
    for (let offset = 0; offset < rows.length; offset += 40) {
      await testDb.db
        .insertInto('account_imports')
        .values(rows.slice(offset, offset + 40))
        .execute()
    }

    expect(
      await database.countAccountImportStartsSince({
        actorId: 'actor-start-count-many',
        since
      })
    ).toBe(count)
  })

  it('selects stale running imports with expired leases across actors', async () => {
    const now = Date.now()
    const before = now - 60 * 60 * 1000
    const stale = await database.createAccountImport({
      id: 'import-stale-query',
      accountId,
      actorId: 'actor-stale-query',
      options: '{}'
    })
    await database.updateAccountImport({
      id: stale.id,
      status: 'running',
      claimedUntil: now - 1000
    })
    await testDb.db
      .updateTable('account_imports')
      .set({ updatedAt: new Date(before - 1000) })
      .where('id', '=', stale.id)
      .execute()

    const leased = await database.createAccountImport({
      id: 'import-live-lease-query',
      accountId,
      actorId: 'actor-live-lease-query',
      options: '{}'
    })
    await database.updateAccountImport({
      id: leased.id,
      status: 'running',
      claimedUntil: now + 60_000
    })
    await testDb.db
      .updateTable('account_imports')
      .set({ updatedAt: new Date(before - 1000) })
      .where('id', '=', leased.id)
      .execute()

    const fresh = await database.createAccountImport({
      id: 'import-fresh-query',
      accountId,
      actorId: 'actor-fresh-query',
      options: '{}'
    })
    await database.updateAccountImport({ id: fresh.id, status: 'running' })

    const found = await database.getStaleAccountImports({
      now,
      before,
      limit: 100
    })
    expect(found.map((row) => row.id)).toEqual([stale.id])
  })

  it('clears cataloged item data when an item becomes done, skipped, or permanently failed', async () => {
    const accountImport = await database.createAccountImport({
      id: 'import-clear-data',
      accountId,
      actorId: 'actor-clear-data',
      options: '{}'
    })
    await database.upsertAccountImportItems({
      importId: accountImport.id,
      actorId: accountImport.actorId,
      items: [
        { kind: 'status', sourceId: 'done-data', position: 1 },
        { kind: 'status', sourceId: 'skipped-data', position: 2 },
        { kind: 'status', sourceId: 'failed-data', position: 3 }
      ]
    })
    const items = await database.getAccountImportItems({
      importId: accountImport.id,
      limit: 10
    })
    for (const item of items) {
      await testDb.db
        .updateTable('account_import_items')
        .set({ data: '{"raw":true}' })
        .where('id', '=', item.id)
        .execute()
      await database.markAccountImportItem({
        id: item.id,
        state:
          item.sourceId === 'done-data'
            ? 'done'
            : item.sourceId === 'skipped-data'
              ? 'skipped'
              : 'failed',
        ...(item.sourceId === 'failed-data' ? { reason: 'invalid' } : {})
      })
    }
    expect(
      await database.resetRetryableAccountImportItems({
        importId: accountImport.id,
        reasons: ['invalid']
      })
    ).toBe(0)

    expect(
      (
        await database.getAccountImportItems({
          importId: accountImport.id,
          limit: 10
        })
      ).map((item) => item.data)
    ).toEqual([null, null, null])
  })

  it.each(['done', 'cancelled', 'failed'] as const)(
    'clears all remaining item data when an import becomes %s',
    async (status) => {
      const accountImport = await database.createAccountImport({
        id: `import-terminal-${status}`,
        accountId,
        actorId: `actor-terminal-${status}`,
        options: '{}'
      })
      await database.upsertAccountImportItems({
        importId: accountImport.id,
        actorId: accountImport.actorId,
        items: [
          {
            kind: 'status',
            sourceId: `pending-${status}`,
            position: 1,
            data: '{"raw":"pending"}'
          },
          {
            kind: 'like',
            sourceId: `failed-${status}`,
            position: 2,
            data: '{"raw":"failed"}'
          }
        ]
      })
      const failedItem = (
        await database.getAccountImportItems({
          importId: accountImport.id,
          limit: 10
        })
      )[1]
      await database.markAccountImportItem({
        id: failedItem.id,
        state: 'failed',
        reason: 'transient',
        retryable: true
      })

      await database.updateAccountImport({ id: accountImport.id, status })

      expect(
        (
          await database.getAccountImportItems({
            importId: accountImport.id,
            limit: 10
          })
        ).map((item) => item.data)
      ).toEqual([null, null])
    }
  )

  it('reclaims pending and failed items while preserving terminal items', async () => {
    const previous = await database.createAccountImport({
      id: 'import-reclaim-previous',
      accountId,
      actorId: 'actor-reclaim',
      options: '{}'
    })
    await database.upsertAccountImportItems({
      importId: previous.id,
      actorId: previous.actorId,
      items: [
        {
          kind: 'status',
          sourceId: 'pending-source',
          position: 1,
          data: '{"v":1}'
        },
        {
          kind: 'status',
          sourceId: 'failed-source',
          position: 2,
          data: '{"v":2}'
        },
        {
          kind: 'status',
          sourceId: 'done-source',
          position: 3,
          data: '{"v":3}'
        },
        {
          kind: 'status',
          sourceId: 'skipped-source',
          position: 4,
          data: '{"v":4}'
        }
      ]
    })
    const previousItems = await database.getAccountImportItems({
      importId: previous.id,
      limit: 10
    })
    for (const [sourceId, state] of [
      ['failed-source', 'failed'],
      ['done-source', 'done'],
      ['skipped-source', 'skipped']
    ] as const) {
      await database.markAccountImportItem({
        id: previousItems.find((item) => item.sourceId === sourceId)!.id,
        state,
        ...(state === 'failed' ? { retryable: true } : {}),
        reason: state === 'failed' ? 'transient' : undefined,
        targetId: state === 'done' ? 'target-done' : undefined
      })
    }
    const doneBefore = (
      await database.getAccountImportItems({
        importId: previous.id,
        limit: 10
      })
    ).find((item) => item.sourceId === 'done-source')
    const skippedBefore = (
      await database.getAccountImportItems({
        importId: previous.id,
        limit: 10
      })
    ).find((item) => item.sourceId === 'skipped-source')
    expect(doneBefore?.data).toBeNull()
    expect(skippedBefore?.data).toBeNull()

    await database.updateAccountImport({
      id: previous.id,
      status: 'cancelled'
    })
    const next = await database.createAccountImport({
      id: 'import-reclaim-next',
      accountId,
      actorId: previous.actorId,
      options: '{}'
    })
    await database.upsertAccountImportItems({
      importId: next.id,
      actorId: next.actorId,
      items: [
        {
          kind: 'status',
          sourceId: 'pending-source',
          position: 11,
          data: '{"v":11}'
        },
        {
          kind: 'status',
          sourceId: 'failed-source',
          position: 12,
          data: '{"v":12}'
        },
        {
          kind: 'status',
          sourceId: 'done-source',
          position: 13,
          data: '{"v":13}'
        },
        {
          kind: 'status',
          sourceId: 'skipped-source',
          position: 14,
          data: '{"v":14}'
        }
      ]
    })

    const oldItems = await database.getAccountImportItems({
      importId: previous.id,
      limit: 10
    })
    expect(oldItems.map((item) => item.sourceId).sort()).toEqual([
      'done-source',
      'skipped-source'
    ])
    expect(
      oldItems.find((item) => item.sourceId === 'done-source')
    ).toMatchObject({
      state: 'done',
      position: 3,
      targetId: 'target-done',
      data: null
    })
    expect(
      oldItems.find((item) => item.sourceId === 'skipped-source')
    ).toMatchObject({
      state: 'skipped',
      position: 4,
      data: null
    })
    const newItems = await database.getAccountImportItems({
      importId: next.id,
      limit: 10
    })
    expect(newItems.map((item) => item.sourceId).sort()).toEqual([
      'failed-source',
      'pending-source'
    ])
    expect(newItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: 'pending-source',
          state: 'pending',
          position: 11,
          data: '{"v":11}',
          reason: null
        }),
        expect.objectContaining({
          sourceId: 'failed-source',
          state: 'pending',
          position: 12,
          data: '{"v":12}',
          reason: null,
          targetId: null
        })
      ])
    )
  })
})
