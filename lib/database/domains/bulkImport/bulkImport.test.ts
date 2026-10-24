import crypto from 'crypto'

import { getBulkImportRowId } from '@/lib/database/domains/bulkImport/queries'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  BULK_IMPORT_STALE_MS,
  type BulkImportRowData
} from '@/lib/services/imports/types'

describe('BulkImportDatabase', () => {
  const testDb = createTestDatabase()
  const { database } = testDb

  const actorUrl = (name: string) => `https://llun.test/users/${name}`

  const seedActor = async (name: string) => {
    const id = actorUrl(name)
    await database.createActor({
      actorId: id,
      username: name,
      domain: 'llun.test',
      publicKey: 'fake-public-key',
      privateKey: 'fake-private-key',
      inboxUrl: `${id}/inbox`,
      sharedInboxUrl: 'https://llun.test/inbox',
      followersUrl: `${id}/followers`,
      createdAt: Date.now()
    })
    return id
  }

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  describe('createBulkImport', () => {
    it('creates bulk import and rows', async () => {
      const actorId = await seedActor(
        `create-${crypto.randomUUID().slice(0, 8)}`
      )
      const importId = crypto.randomUUID()
      const rows: BulkImportRowData[] = [
        { acct: 'alice@example.com', show_reblogs: true },
        { acct: 'bob@example.com', notify: false }
      ]

      const created = await database.createBulkImport({
        id: importId,
        actorId,
        type: 'following',
        overwrite: false,
        originalFilename: 'following.csv',
        rows
      })

      expect(created).toEqual({
        id: importId,
        actorId,
        type: 'following',
        overwrite: false,
        state: 'scheduled',
        originalFilename: 'following.csv',
        totalItems: 2,
        processedItems: 0,
        importedItems: 0,
        overwriteDone: false,
        nextRowIndex: 0,
        overwriteProgress: 0,
        listsPrepared: false,
        lastError: null,
        finishedAt: null,
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number)
      })

      // Get by id + actorId
      const fetched = await database.getBulkImport({ id: importId, actorId })
      expect(fetched).toEqual(created)

      // Scoped to actorId
      const wrongActor = await database.getBulkImport({
        id: importId,
        actorId: 'https://other.test/users/other'
      })
      expect(wrongActor).toBeNull()

      // Get by id alone
      const fetchedById = await database.getBulkImportById({ id: importId })
      expect(fetchedById).toEqual(created)

      const nonExistent = await database.getBulkImportById({
        id: 'non-existent'
      })
      expect(nonExistent).toBeNull()

      // Rows created
      const dbRows = await database.getBulkImportRows({
        importId,
        fromRowIndex: 0,
        limit: 10
      })
      expect(dbRows).toHaveLength(2)
      expect(dbRows[0]).toEqual({
        id: getBulkImportRowId(importId, 0),
        importId,
        rowIndex: 0,
        data: rows[0],
        state: 'pending',
        error: null
      })
      expect(dbRows[1]).toEqual({
        id: getBulkImportRowId(importId, 1),
        importId,
        rowIndex: 1,
        data: rows[1],
        state: 'pending',
        error: null
      })
    })

    it('returns null when another import is unfinished for the same actor', async () => {
      const actorId = await seedActor(`busy-${crypto.randomUUID().slice(0, 8)}`)
      const firstId = crypto.randomUUID()
      const secondId = crypto.randomUUID()

      const first = await database.createBulkImport({
        id: firstId,
        actorId,
        type: 'blocking',
        overwrite: true,
        originalFilename: 'blocks.csv',
        rows: [{ acct: 'spam@example.com' }]
      })
      expect(first).not.toBeNull()

      // Second while first is scheduled
      const second = await database.createBulkImport({
        id: secondId,
        actorId,
        type: 'blocking',
        overwrite: false,
        originalFilename: 'blocks2.csv',
        rows: [{ acct: 'spam2@example.com' }]
      })
      expect(second).toBeNull()

      // Still returns null when first is in_progress
      await database.updateBulkImport({ id: firstId, state: 'in_progress' })
      const third = await database.createBulkImport({
        id: secondId,
        actorId,
        type: 'blocking',
        overwrite: false,
        originalFilename: 'blocks2.csv',
        rows: [{ acct: 'spam2@example.com' }]
      })
      expect(third).toBeNull()
    })

    it('abandons a stale unfinished import but still blocks on a fresh one', async () => {
      const actorId = await seedActor(
        `stale-${crypto.randomUUID().slice(0, 8)}`
      )
      const firstId = crypto.randomUUID()
      const params = (id: string) => ({
        id,
        actorId,
        type: 'bookmarks' as const,
        overwrite: false,
        originalFilename: 'b.csv',
        rows: [{ uri: 'https://example.com/status/1' }]
      })
      await database.createBulkImport(params(firstId))

      // Fresh: still blocks
      expect(
        await database.createBulkImport(params(crypto.randomUUID()))
      ).toBeNull()

      // Stale: no progress for more than 24 hours
      await testDb.db
        .updateTable('bulk_imports')
        .set({ updatedAt: new Date(Date.now() - BULK_IMPORT_STALE_MS - 1000) })
        .where('id', '=', firstId)
        .execute()
      const secondId = crypto.randomUUID()
      expect(await database.createBulkImport(params(secondId))).not.toBeNull()

      const first = await database.getBulkImportById({ id: firstId })
      expect(first?.state).toBe('finished')
      expect(first?.lastError).toBe('Abandoned: no progress for 24 hours')
      expect(first?.finishedAt).not.toBeNull()
    })

    it('allows creation after the first import is finished', async () => {
      const actorId = await seedActor(
        `finished-${crypto.randomUUID().slice(0, 8)}`
      )
      const firstId = crypto.randomUUID()
      const secondId = crypto.randomUUID()

      await database.createBulkImport({
        id: firstId,
        actorId,
        type: 'bookmarks',
        overwrite: false,
        originalFilename: 'bookmarks.csv',
        rows: [{ uri: 'https://example.com/status/1' }]
      })

      // Finish first
      await database.updateBulkImport({
        id: firstId,
        state: 'finished',
        finishedAt: Date.now()
      })

      // Second should now succeed
      const second = await database.createBulkImport({
        id: secondId,
        actorId,
        type: 'bookmarks',
        overwrite: false,
        originalFilename: 'bookmarks2.csv',
        rows: [{ uri: 'https://example.com/status/2' }]
      })
      expect(second).not.toBeNull()
      expect(second?.id).toBe(secondId)
    })

    it('does not block imports for another actor', async () => {
      const actorId1 = await seedActor(
        `concurrent1-${crypto.randomUUID().slice(0, 8)}`
      )
      const actorId2 = await seedActor(
        `concurrent2-${crypto.randomUUID().slice(0, 8)}`
      )
      const id1 = crypto.randomUUID()
      const id2 = crypto.randomUUID()

      const first = await database.createBulkImport({
        id: id1,
        actorId: actorId1,
        type: 'muting',
        overwrite: false,
        originalFilename: 'mutes1.csv',
        rows: [{ acct: 'mute1@example.com' }]
      })
      expect(first).not.toBeNull()

      // Actor 2 can create import while Actor 1 has an unfinished import
      const second = await database.createBulkImport({
        id: id2,
        actorId: actorId2,
        type: 'muting',
        overwrite: false,
        originalFilename: 'mutes2.csv',
        rows: [{ acct: 'mute2@example.com' }]
      })
      expect(second).not.toBeNull()
      expect(second?.id).toBe(id2)
    })
  })

  describe('getBulkImports', () => {
    it('returns imports ordered by createdAt desc with limit and actor scoping', async () => {
      const actorId = await seedActor(`list-${crypto.randomUUID().slice(0, 8)}`)
      const otherActorId = await seedActor(
        `list-other-${crypto.randomUUID().slice(0, 8)}`
      )

      // Create import 1, finish it, then import 2
      const id1 = crypto.randomUUID()
      await database.createBulkImport({
        id: id1,
        actorId,
        type: 'following',
        overwrite: false,
        originalFilename: 'first.csv',
        rows: []
      })
      await database.updateBulkImport({
        id: id1,
        state: 'finished',
        finishedAt: Date.now()
      })

      const id2 = crypto.randomUUID()
      await database.createBulkImport({
        id: id2,
        actorId,
        type: 'blocking',
        overwrite: true,
        originalFilename: 'second.csv',
        rows: []
      })

      // Other actor's import
      const otherId = crypto.randomUUID()
      await database.createBulkImport({
        id: otherId,
        actorId: otherActorId,
        type: 'lists',
        overwrite: false,
        originalFilename: 'other.csv',
        rows: []
      })

      // Fetches all for actorId, ordered by createdAt desc
      const imports = await database.getBulkImports({ actorId })
      expect(imports).toHaveLength(2)
      expect(imports[0].id).toBe(id2)
      expect(imports[1].id).toBe(id1)

      // Respects limit
      const limited = await database.getBulkImports({ actorId, limit: 1 })
      expect(limited).toHaveLength(1)
      expect(limited[0].id).toBe(id2)

      // Other actor only sees theirs
      const otherImports = await database.getBulkImports({
        actorId: otherActorId
      })
      expect(otherImports).toHaveLength(1)
      expect(otherImports[0].id).toBe(otherId)
    })
  })

  describe('getBulkImportRows', () => {
    it('supports paging and state filtering', async () => {
      const actorId = await seedActor(
        `paging-${crypto.randomUUID().slice(0, 8)}`
      )
      const importId = crypto.randomUUID()
      const rows: BulkImportRowData[] = [
        { acct: 'user0@example.com' },
        { acct: 'user1@example.com' },
        { acct: 'user2@example.com' },
        { acct: 'user3@example.com' },
        { acct: 'user4@example.com' }
      ]

      await database.createBulkImport({
        id: importId,
        actorId,
        type: 'following',
        overwrite: false,
        originalFilename: 'users.csv',
        rows
      })

      // Paging test
      const page1 = await database.getBulkImportRows({
        importId,
        fromRowIndex: 0,
        limit: 2
      })
      expect(page1).toHaveLength(2)
      expect(page1.map((r) => r.rowIndex)).toEqual([0, 1])

      const page2 = await database.getBulkImportRows({
        importId,
        fromRowIndex: 2,
        limit: 2
      })
      expect(page2).toHaveLength(2)
      expect(page2.map((r) => r.rowIndex)).toEqual([2, 3])

      const page3 = await database.getBulkImportRows({
        importId,
        fromRowIndex: 4,
        limit: 2
      })
      expect(page3).toHaveLength(1)
      expect(page3[0].rowIndex).toBe(4)

      // Process some rows
      await database.markBulkImportRowProcessed({
        importId,
        rowId: getBulkImportRowId(importId, 0),
        imported: true
      })
      await database.markBulkImportRowProcessed({
        importId,
        rowId: getBulkImportRowId(importId, 1),
        imported: false,
        error: 'Failed to import'
      })

      // State filter test
      const pendingRows = await database.getBulkImportRows({
        importId,
        fromRowIndex: 0,
        limit: 10,
        state: 'pending'
      })
      expect(pendingRows.map((r) => r.rowIndex)).toEqual([2, 3, 4])

      const importedRows = await database.getBulkImportRows({
        importId,
        fromRowIndex: 0,
        limit: 10,
        state: 'imported'
      })
      expect(importedRows.map((r) => r.rowIndex)).toEqual([0])

      const failedRows = await database.getBulkImportRows({
        importId,
        fromRowIndex: 0,
        limit: 10,
        state: 'failed'
      })
      expect(failedRows.map((r) => r.rowIndex)).toEqual([1])
    })
  })

  describe('markBulkImportRowProcessed', () => {
    it('is idempotent, updates counts, and auto-finishes when all rows processed', async () => {
      const actorId = await seedActor(
        `process-${crypto.randomUUID().slice(0, 8)}`
      )
      const importId = crypto.randomUUID()
      const rows: BulkImportRowData[] = [
        { acct: 'first@example.com' },
        { acct: 'second@example.com' }
      ]

      await database.createBulkImport({
        id: importId,
        actorId,
        type: 'following',
        overwrite: false,
        originalFilename: 'test.csv',
        rows
      })

      const row0Id = getBulkImportRowId(importId, 0)
      const row1Id = getBulkImportRowId(importId, 1)

      // First call for row 0 -> true
      const res1 = await database.markBulkImportRowProcessed({
        importId,
        rowId: row0Id,
        imported: true
      })
      expect(res1).toBe(true)

      let imp = await database.getBulkImportById({ id: importId })
      expect(imp?.processedItems).toBe(1)
      expect(imp?.importedItems).toBe(1)
      expect(imp?.state).toBe('scheduled')
      expect(imp?.finishedAt).toBeNull()

      // Second call for row 0 -> false (idempotent, no double count)
      const resDuplicate = await database.markBulkImportRowProcessed({
        importId,
        rowId: row0Id,
        imported: true
      })
      expect(resDuplicate).toBe(false)

      imp = await database.getBulkImportById({ id: importId })
      expect(imp?.processedItems).toBe(1)
      expect(imp?.importedItems).toBe(1)

      // Process row 1 with failure
      const res2 = await database.markBulkImportRowProcessed({
        importId,
        rowId: row1Id,
        imported: false,
        error: 'Actor not found'
      })
      expect(res2).toBe(true)

      // Since processedItems (2) >= totalItems (2), import must auto-finish
      imp = await database.getBulkImportById({ id: importId })
      expect(imp?.processedItems).toBe(2)
      expect(imp?.importedItems).toBe(1)
      expect(imp?.state).toBe('finished')
      expect(imp?.finishedAt).toBeTypeOf('number')

      // Verify row state and error
      const failedRows = await database.getBulkImportFailedRows({ importId })
      expect(failedRows).toHaveLength(1)
      expect(failedRows[0]).toEqual({
        id: row1Id,
        importId,
        rowIndex: 1,
        data: rows[1],
        state: 'failed',
        error: 'Actor not found'
      })
    })
  })

  describe('getBulkImportFailedRows', () => {
    it('returns only failed rows ordered by rowIndex asc with limit', async () => {
      const actorId = await seedActor(
        `failed-${crypto.randomUUID().slice(0, 8)}`
      )
      const importId = crypto.randomUUID()
      const rows: BulkImportRowData[] = [
        { acct: 'fail0@example.com' },
        { acct: 'pass1@example.com' },
        { acct: 'fail2@example.com' }
      ]

      await database.createBulkImport({
        id: importId,
        actorId,
        type: 'following',
        overwrite: false,
        originalFilename: 'failed.csv',
        rows
      })

      await database.markBulkImportRowProcessed({
        importId,
        rowId: getBulkImportRowId(importId, 0),
        imported: false,
        error: 'Error 0'
      })
      await database.markBulkImportRowProcessed({
        importId,
        rowId: getBulkImportRowId(importId, 1),
        imported: true
      })
      await database.markBulkImportRowProcessed({
        importId,
        rowId: getBulkImportRowId(importId, 2),
        imported: false,
        error: 'Error 2'
      })

      const allFailed = await database.getBulkImportFailedRows({ importId })
      expect(allFailed).toHaveLength(2)
      expect(allFailed[0].rowIndex).toBe(0)
      expect(allFailed[0].error).toBe('Error 0')
      expect(allFailed[1].rowIndex).toBe(2)
      expect(allFailed[1].error).toBe('Error 2')

      const limitedFailed = await database.getBulkImportFailedRows({
        importId,
        limit: 1
      })
      expect(limitedFailed).toHaveLength(1)
      expect(limitedFailed[0].rowIndex).toBe(0)
    })
  })

  describe('updateBulkImport', () => {
    it('updates fields including clearing nullable fields', async () => {
      const actorId = await seedActor(
        `update-${crypto.randomUUID().slice(0, 8)}`
      )
      const importId = crypto.randomUUID()

      await database.createBulkImport({
        id: importId,
        actorId,
        type: 'following',
        overwrite: true,
        originalFilename: 'update.csv',
        rows: []
      })

      const finishedTime = Date.now()
      await database.updateBulkImport({
        id: importId,
        state: 'in_progress',
        nextRowIndex: 42,
        overwriteDone: true,
        lastError: 'Fatal error occurred',
        finishedAt: finishedTime
      })

      let imp = await database.getBulkImportById({ id: importId })
      expect(imp?.state).toBe('in_progress')
      expect(imp?.nextRowIndex).toBe(42)
      expect(imp?.overwriteDone).toBe(true)
      expect(imp?.lastError).toBe('Fatal error occurred')
      expect(imp?.finishedAt).toBe(finishedTime)

      // Clear nullable fields
      await database.updateBulkImport({
        id: importId,
        lastError: null,
        finishedAt: null
      })

      imp = await database.getBulkImportById({ id: importId })
      expect(imp?.lastError).toBeNull()
      expect(imp?.finishedAt).toBeNull()
    })
  })

  describe('overwrite checkpoint and list preparation flags', () => {
    it('stores overwriteProgress and listsPrepared', async () => {
      const actorId = await seedActor(
        `flags-${crypto.randomUUID().slice(0, 8)}`
      )
      const importId = crypto.randomUUID()
      await database.createBulkImport({
        id: importId,
        actorId,
        type: 'lists',
        overwrite: true,
        originalFilename: 'lists.csv',
        rows: []
      })

      await database.updateBulkImport({
        id: importId,
        overwriteProgress: 7,
        listsPrepared: true
      })

      expect(await database.getBulkImportById({ id: importId })).toMatchObject({
        overwriteProgress: 7,
        listsPrepared: true
      })
    })
  })

  describe('updateBulkImportRowData', () => {
    it('replaces the data of one row only', async () => {
      const actorId = await seedActor(
        `rowdata-${crypto.randomUUID().slice(0, 8)}`
      )
      const importId = crypto.randomUUID()
      await database.createBulkImport({
        id: importId,
        actorId,
        type: 'following',
        overwrite: true,
        originalFilename: 'following.csv',
        rows: [{ acct: 'a@example.com' }, { acct: 'b@example.com' }]
      })

      await database.updateBulkImportRowData({
        importId,
        rowId: getBulkImportRowId(importId, 0),
        data: { acct: 'a@example.com', resolvedActorId: 'https://x.test/a' }
      })

      const rows = await database.getBulkImportRows({
        importId,
        fromRowIndex: 0,
        limit: 10
      })
      expect(rows.map((row) => row.data)).toEqual([
        { acct: 'a@example.com', resolvedActorId: 'https://x.test/a' },
        { acct: 'b@example.com' }
      ])
    })
  })

  describe('claimBulkImportRun / releaseBulkImportRun', () => {
    const createImport = async () => {
      const actorId = await seedActor(
        `claim-${crypto.randomUUID().slice(0, 8)}`
      )
      const id = crypto.randomUUID()
      await database.createBulkImport({
        id,
        actorId,
        type: 'following',
        overwrite: false,
        originalFilename: 'following.csv',
        rows: []
      })
      return id
    }

    it('lets one run claim at a time and reports when the claim lapses', async () => {
      const id = await createImport()
      const before = Date.now()

      expect(
        await database.claimBulkImportRun({
          id,
          runToken: 'a',
          leaseMs: 60_000
        })
      ).toEqual({ claimed: true })
      const second = await database.claimBulkImportRun({
        id,
        runToken: 'b',
        leaseMs: 60_000
      })
      expect(second).toMatchObject({ claimed: false })
      expect(
        (second as { claimedUntil: number }).claimedUntil
      ).toBeGreaterThanOrEqual(before + 60_000)
    })

    it('releases only with the holder token', async () => {
      const id = await createImport()
      await database.claimBulkImportRun({ id, runToken: 'a', leaseMs: 60_000 })

      await database.releaseBulkImportRun({ id, runToken: 'other' })
      expect(
        await database.claimBulkImportRun({ id, runToken: 'b', leaseMs: 1000 })
      ).toMatchObject({ claimed: false })

      await database.releaseBulkImportRun({ id, runToken: 'a' })
      expect(
        await database.claimBulkImportRun({ id, runToken: 'b', leaseMs: 1000 })
      ).toEqual({ claimed: true })
    })

    it('can be claimed again once the lease has lapsed', async () => {
      const id = await createImport()
      await database.claimBulkImportRun({ id, runToken: 'a', leaseMs: -1000 })

      expect(
        await database.claimBulkImportRun({ id, runToken: 'b', leaseMs: 1000 })
      ).toEqual({ claimed: true })
      // The lapsed holder's late release must not clear the new claim.
      await database.releaseBulkImportRun({ id, runToken: 'a' })
      expect(
        await database.claimBulkImportRun({ id, runToken: 'c', leaseMs: 1000 })
      ).toMatchObject({ claimed: false })
    })

    it('renews the lease only for the holder token', async () => {
      const id = await createImport()
      await database.claimBulkImportRun({ id, runToken: 'a', leaseMs: 1000 })
      const claimedUntil = async () =>
        (
          (await database.claimBulkImportRun({
            id,
            runToken: 'probe',
            leaseMs: 1
          })) as { claimedUntil: number }
        ).claimedUntil
      const first = await claimedUntil()

      expect(
        await database.renewBulkImportRun({
          id,
          runToken: 'a',
          leaseMs: 60_000
        })
      ).toBe(true)
      const extended = await claimedUntil()
      expect(extended).toBeGreaterThan(first + 50_000)

      // Another run holds the import now: the old holder cannot extend it.
      expect(
        await database.renewBulkImportRun({
          id,
          runToken: 'thief',
          leaseMs: 120_000
        })
      ).toBe(false)
      expect(await claimedUntil()).toBe(extended)
      expect(
        await database.renewBulkImportRun({
          id: 'missing',
          runToken: 'a',
          leaseMs: 1000
        })
      ).toBe(false)
    })

    it('does not claim an import that does not exist', async () => {
      expect(
        await database.claimBulkImportRun({
          id: 'missing',
          runToken: 'a',
          leaseMs: 1000
        })
      ).toEqual({ claimed: false, claimedUntil: null })
    })
  })

  describe('chunked insert with > 1,000 rows', () => {
    it('successfully inserts 1,050 rows in chunks', async () => {
      const actorId = await seedActor(
        `chunk-${crypto.randomUUID().slice(0, 8)}`
      )
      const importId = crypto.randomUUID()
      const totalCount = 1050
      const rows: BulkImportRowData[] = Array.from(
        { length: totalCount },
        (_, index) => ({
          acct: `user_${index}@example.com`
        })
      )

      const created = await database.createBulkImport({
        id: importId,
        actorId,
        type: 'following',
        overwrite: false,
        originalFilename: 'large.csv',
        rows
      })

      expect(created?.totalItems).toBe(totalCount)

      // Verify start
      const startRows = await database.getBulkImportRows({
        importId,
        fromRowIndex: 0,
        limit: 5
      })
      expect(startRows).toHaveLength(5)
      expect(startRows[0].rowIndex).toBe(0)
      expect(startRows[0].data).toEqual({ acct: 'user_0@example.com' })

      // Verify boundary around chunk size (500)
      const midRows = await database.getBulkImportRows({
        importId,
        fromRowIndex: 498,
        limit: 5
      })
      expect(midRows).toHaveLength(5)
      expect(midRows.map((r) => r.rowIndex)).toEqual([498, 499, 500, 501, 502])

      // Verify end
      const endRows = await database.getBulkImportRows({
        importId,
        fromRowIndex: 1045,
        limit: 10
      })
      expect(endRows).toHaveLength(5)
      expect(endRows.map((r) => r.rowIndex)).toEqual([
        1045, 1046, 1047, 1048, 1049
      ])
    })
  })
})
