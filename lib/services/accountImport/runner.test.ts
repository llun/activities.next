import {
  GetObjectCommand,
  HeadObjectCommand,
  type S3Client
} from '@aws-sdk/client-s3'

import { MediaStorageType } from '@/lib/config/mediaStorage'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { S3ArchiveObjectStore } from '@/lib/services/accountArchive/objectStore'
import {
  ACCOUNT_IMPORT_MAX_STUCK_MS,
  ACCOUNT_IMPORT_QUEUED_EXPIRY_MS,
  ACCOUNT_IMPORT_STUCK_AFTER_MS
} from '@/lib/services/accountImport/constants'
import {
  createAccountImportObjectStore,
  getAccountImportObjectStore
} from '@/lib/services/accountImport/objectStore'
import type { AccountImportObjectStore } from '@/lib/services/accountImport/objectStore'
import {
  inspectAccountArchive,
  runStatusesPhase
} from '@/lib/services/accountImport/phases'
import {
  parseImportProgress,
  serializeImportProgress
} from '@/lib/services/accountImport/progress'
import { sweepStuckAccountImports } from '@/lib/services/accountImport/reaper'
import {
  getAccountImportContinuationJobId,
  runAccountImport
} from '@/lib/services/accountImport/runner'
import { openZipArchive } from '@/lib/services/accountImport/zip/reader'
import { buildZip } from '@/lib/services/accountImport/zip/testing/fixtures'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'

vi.mock('@/lib/services/accountImport/objectStore', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('@/lib/services/accountImport/objectStore')
    >()
  return { ...original, getAccountImportObjectStore: vi.fn() }
})

vi.mock('@/lib/services/accountImport/phases', () => ({
  inspectAccountArchive: vi.fn(),
  runAlbumsPhase: vi.fn(),
  runCatalogPhase: vi.fn(),
  runCollectionsNoopPhase: vi.fn(),
  runFitnessPhase: vi.fn(),
  runGearsPhase: vi.fn(),
  runMastodonMediaPhase: vi.fn(),
  runOwnArchiveMediaPhase: vi.fn(),
  runProfilePhase: vi.fn(),
  runSettingsPhase: vi.fn(),
  runStatusesPhase: vi.fn()
}))

describe('account import runner payload cleanup', () => {
  const testDb = createTestDatabase({ backend: 'sqlite' })
  const { database, db, prepare, destroy } = testDb
  const deleteUpload = vi.fn().mockResolvedValue(undefined)
  const objectStore = {
    deleteUpload
  } as unknown as AccountImportObjectStore
  let actorId: string
  let accountId: string

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    const actor = await database.getActorFromEmail({ email: seedActor1.email })
    actorId = actor!.id
    accountId = actor!.account!.id
  })

  afterAll(async () => {
    await destroy()
  })

  beforeEach(async () => {
    await db.deleteFrom('account_import_items').execute()
    await db.deleteFrom('account_imports').execute()
    await db
      .updateTable('actors')
      .set({ suspendedAt: null, deletionStatus: null })
      .where('id', '=', actorId)
      .execute()
    vi.mocked(getAccountImportObjectStore)
      .mockReset()
      .mockReturnValue(objectStore)
    deleteUpload.mockReset().mockResolvedValue(undefined)
    vi.mocked(runStatusesPhase)
      .mockReset()
      .mockImplementation(async (_context, progress, cursor) => ({
        result: 'budget',
        progress,
        cursor
      }))
    vi.mocked(inspectAccountArchive).mockReset()
  })

  const createImportWithItem = async (id: string) => {
    const accountImport = await database.createAccountImport({
      id,
      accountId,
      actorId,
      options: '{}'
    })
    await database.upsertAccountImportItems({
      importId: accountImport.id,
      actorId,
      items: [
        {
          kind: 'status',
          sourceId: `${id}-status`,
          position: 1,
          data: '{"raw":"archive payload"}'
        }
      ]
    })
    return accountImport
  }

  const getItemData = async (importId: string) =>
    (await database.getAccountImportItems({ importId, limit: 10 })).map(
      (item) => item.data
    )

  it('clears remaining item data when the runner finishes', async () => {
    const accountImport = await createImportWithItem('import-runner-finish')
    await database.updateAccountImport({
      id: accountImport.id,
      status: 'running',
      phase: 'finish'
    })

    const result = await runAccountImport(database, accountImport.id, {
      actorId,
      runToken: 'finish-run',
      now: Date.now,
      runsInline: true
    })

    expect(result).toEqual({ type: 'done' })
    expect(await getItemData(accountImport.id)).toEqual([null])
  })

  it('clears remaining item data when cancellation becomes terminal', async () => {
    const accountImport = await createImportWithItem('import-runner-cancel')
    await database.updateAccountImport({
      id: accountImport.id,
      status: 'cancelled',
      finishedAt: Date.now()
    })

    const result = await runAccountImport(database, accountImport.id, {
      actorId,
      runToken: 'cancel-run'
    })

    expect(result).toEqual({ type: 'cancelled' })
    expect(await getItemData(accountImport.id)).toEqual([null])
  })

  it('clears remaining item data when the sweep fails a stuck import', async () => {
    const accountImport = await createImportWithItem('import-runner-sweep')
    await database.updateAccountImport({
      id: accountImport.id,
      status: 'running'
    })
    const now = Date.now()
    await db
      .updateTable('account_imports')
      .set({
        updatedAt: new Date(now - ACCOUNT_IMPORT_MAX_STUCK_MS - 1),
        claimedUntil: null
      })
      .where('id', '=', accountImport.id)
      .execute()

    expect(now - (now - ACCOUNT_IMPORT_MAX_STUCK_MS - 1)).toBeGreaterThan(
      ACCOUNT_IMPORT_STUCK_AFTER_MS
    )
    expect(await sweepStuckAccountImports(database, now)).toBe(1)
    expect(
      await database.getAccountImport({ id: accountImport.id, actorId })
    ).toMatchObject({ status: 'failed', lastErrorCode: 'import_stuck' })
    expect(await getItemData(accountImport.id)).toEqual([null])
  })

  it('expires a queued upload that was never started and deletes its upload', async () => {
    const accountImport = await createImportWithItem(
      'import-runner-queued-expired'
    )
    const now = Date.now()
    await db
      .updateTable('account_imports')
      .set({ createdAt: new Date(now - ACCOUNT_IMPORT_QUEUED_EXPIRY_MS - 1) })
      .where('id', '=', accountImport.id)
      .execute()
    const schedule = vi.fn().mockResolvedValue(undefined)

    expect(await sweepStuckAccountImports(database, now, schedule)).toBe(1)
    expect(schedule).not.toHaveBeenCalled()
    expect(
      await database.getAccountImport({ id: accountImport.id, actorId })
    ).toMatchObject({ status: 'failed', lastErrorCode: 'upload_expired' })
    expect(deleteUpload).toHaveBeenCalledWith(
      expect.objectContaining({ id: accountImport.id })
    )
  })

  it('leaves a fresh queued upload to its owner', async () => {
    const accountImport = await createImportWithItem(
      'import-runner-queued-fresh'
    )
    const now = Date.now()
    const schedule = vi.fn().mockResolvedValue(undefined)

    expect(await sweepStuckAccountImports(database, now, schedule)).toBe(0)
    expect(
      await database.getAccountImport({ id: accountImport.id, actorId })
    ).toMatchObject({ status: 'queued', lastErrorCode: null })
    expect(deleteUpload).not.toHaveBeenCalled()
  })

  it('does not expire a queued import a start just claimed', async () => {
    const accountImport = await createImportWithItem(
      'import-runner-queued-started'
    )
    const now = Date.now()
    await db
      .updateTable('account_imports')
      .set({ createdAt: new Date(now - ACCOUNT_IMPORT_QUEUED_EXPIRY_MS - 1) })
      .where('id', '=', accountImport.id)
      .execute()
    // A start flips the row to running before the sweep's update runs.
    await database.updateAccountImport({
      id: accountImport.id,
      status: 'running',
      startedAt: now
    })
    const schedule = vi.fn().mockResolvedValue(undefined)

    expect(await sweepStuckAccountImports(database, now, schedule)).toBe(0)
    expect(
      await database.getAccountImport({ id: accountImport.id, actorId })
    ).toMatchObject({ status: 'running' })
    expect(deleteUpload).not.toHaveBeenCalled()
  })

  it('fails a suspended actor import in the stale sweep instead of requeueing it', async () => {
    const accountImport = await createImportWithItem(
      'import-runner-sweep-suspended'
    )
    const now = Date.now()
    await db
      .updateTable('actors')
      .set({ suspendedAt: new Date(now) })
      .where('id', '=', actorId)
      .execute()
    await db
      .updateTable('account_imports')
      .set({
        status: 'running',
        updatedAt: new Date(now - ACCOUNT_IMPORT_STUCK_AFTER_MS - 1),
        claimedUntil: null
      })
      .where('id', '=', accountImport.id)
      .execute()
    const schedule = vi.fn().mockResolvedValue(undefined)

    expect(await sweepStuckAccountImports(database, now, schedule)).toBe(1)
    expect(schedule).not.toHaveBeenCalled()
    expect(
      await database.getAccountImport({ id: accountImport.id, actorId })
    ).toMatchObject({ status: 'failed', lastErrorCode: 'actor_unavailable' })
    expect(await getItemData(accountImport.id)).toEqual([null])
    expect(deleteUpload).toHaveBeenCalledWith(
      expect.objectContaining({ id: accountImport.id })
    )
  })

  it.each(['scheduled', 'deleting'] as const)(
    'fails an actor with deletion state %s in the stale sweep',
    async (deletionStatus) => {
      const accountImport = await createImportWithItem(
        `import-runner-sweep-${deletionStatus}`
      )
      const now = Date.now()
      await db
        .updateTable('actors')
        .set({ deletionStatus })
        .where('id', '=', actorId)
        .execute()
      await db
        .updateTable('account_imports')
        .set({
          status: 'running',
          updatedAt: new Date(now - ACCOUNT_IMPORT_STUCK_AFTER_MS - 1),
          claimedUntil: null
        })
        .where('id', '=', accountImport.id)
        .execute()
      const schedule = vi.fn().mockResolvedValue(undefined)

      expect(await sweepStuckAccountImports(database, now, schedule)).toBe(1)
      expect(schedule).not.toHaveBeenCalled()
      expect(
        await database.getAccountImport({ id: accountImport.id, actorId })
      ).toMatchObject({ status: 'failed', lastErrorCode: 'actor_unavailable' })
      expect(await getItemData(accountImport.id)).toEqual([null])
      expect(deleteUpload).toHaveBeenCalledWith(
        expect.objectContaining({ id: accountImport.id })
      )
    }
  )

  it('fails a stale import when its actor has been deleted instead of requeueing it', async () => {
    const accountImport = await createImportWithItem(
      'import-runner-sweep-deleted'
    )
    const now = Date.now()
    await db
      .updateTable('account_imports')
      .set({
        status: 'running',
        updatedAt: new Date(now - ACCOUNT_IMPORT_STUCK_AFTER_MS - 1),
        claimedUntil: null
      })
      .where('id', '=', accountImport.id)
      .execute()
    const getActor = vi
      .spyOn(database, 'getActorFromId')
      .mockResolvedValue(null)
    const schedule = vi.fn().mockResolvedValue(undefined)

    try {
      expect(await sweepStuckAccountImports(database, now, schedule)).toBe(1)
      expect(getActor).toHaveBeenCalledWith({ id: actorId })
      expect(schedule).not.toHaveBeenCalled()
      expect(
        await database.getAccountImport({ id: accountImport.id, actorId })
      ).toMatchObject({ status: 'failed', lastErrorCode: 'actor_unavailable' })
      expect(await getItemData(accountImport.id)).toEqual([null])
      expect(deleteUpload).toHaveBeenCalledWith(
        expect.objectContaining({ id: accountImport.id })
      )
    } finally {
      getActor.mockRestore()
    }
  })

  it('fails a queued continuation for a suspended actor before its status phase writes', async () => {
    const accountImport = await createImportWithItem('import-runner-suspended')
    const now = Date.now()
    await db
      .updateTable('actors')
      .set({ suspendedAt: new Date(now) })
      .where('id', '=', actorId)
      .execute()
    await database.updateAccountImport({
      id: accountImport.id,
      status: 'running',
      phase: 'statuses'
    })

    const result = await runAccountImport(database, accountImport.id, {
      actorId,
      runToken: 'suspended-continuation',
      now: () => now,
      runsInline: true
    })

    expect(result).toEqual({ type: 'failed' })
    expect(runStatusesPhase).not.toHaveBeenCalled()
    expect(
      await database.getAccountImport({ id: accountImport.id, actorId })
    ).toMatchObject({ status: 'failed', lastErrorCode: 'actor_unavailable' })
    expect(await getItemData(accountImport.id)).toEqual([null])
    expect(deleteUpload).toHaveBeenCalledWith(
      expect.objectContaining({ id: accountImport.id })
    )
  })

  it('fails an import as archive_changed when S3 rejects its pinned ETag', async () => {
    const archive = buildZip([
      {
        name: 'actor.json',
        data: Buffer.from('{"id":"https://source.test/users/owner"}')
      }
    ])
    const s3Send = vi.fn(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        return { ContentLength: archive.length, ETag: '"version-2"' }
      }
      if (command instanceof GetObjectCommand) {
        if (command.input.IfMatch === '"version-1"') {
          throw Object.assign(new Error('object changed'), {
            name: 'PreconditionFailed',
            $metadata: { httpStatusCode: 412 }
          })
        }
        const range = /bytes=(\d+)-(\d+)/.exec(command.input.Range ?? '')
        const start = Number(range?.[1] ?? 0)
        const endInclusive = Number(range?.[2] ?? archive.length - 1)
        return {
          ContentRange: `bytes ${start}-${endInclusive}/${archive.length}`,
          Body: {
            transformToByteArray: async () =>
              archive.subarray(start, endInclusive + 1)
          }
        }
      }
      return {}
    })
    const s3Store = new S3ArchiveObjectStore(
      {
        type: MediaStorageType.S3Storage,
        bucket: 'bucket',
        region: 'us-east-1'
      },
      { send: s3Send } as unknown as S3Client
    )
    const importStore = createAccountImportObjectStore(s3Store)!
    vi.mocked(getAccountImportObjectStore).mockReturnValue(importStore)

    const accountImport = await createImportWithItem(
      'import-runner-archive-changed'
    )
    await database.updateAccountImport({
      id: accountImport.id,
      status: 'running',
      phase: 'inspect',
      uploadedBytes: archive.length,
      archiveETag: '"version-1"'
    })
    vi.mocked(inspectAccountArchive).mockImplementationOnce(
      async ({ objectStore: sourceStore, accountImport: current }) => {
        const source = await sourceStore.openSource(current)
        const opened = await openZipArchive(source!)
        await opened.close()
        return {
          kind: 'mastodon',
          sourceActorId: 'https://source.test/users/owner',
          sourceFollowersUrl: null
        }
      }
    )

    const result = await runAccountImport(database, accountImport.id, {
      actorId,
      runToken: 'archive-changed-run',
      runsInline: true
    })

    expect(result).toEqual({ type: 'failed' })
    expect(
      await database.getAccountImport({ id: accountImport.id, actorId })
    ).toMatchObject({ status: 'failed', lastErrorCode: 'archive_changed' })
    expect(
      s3Send.mock.calls.some(
        ([command]) =>
          command instanceof GetObjectCommand &&
          command.input.IfMatch === '"version-1"'
      )
    ).toBe(true)
  })

  it('continues a second pass over the same cursor with a fresh queue id', async () => {
    const accountImport = await createImportWithItem('import-runner-pass-ids')
    await database.updateAccountImport({
      id: accountImport.id,
      status: 'running',
      phase: 'statuses',
      cursor: 'X'
    })

    const first = await runAccountImport(database, accountImport.id, {
      actorId,
      runToken: 'pass-first',
      now: () => 1,
      runsInline: false
    })
    const second = await runAccountImport(database, accountImport.id, {
      actorId,
      runToken: 'pass-second',
      now: () => 1,
      runsInline: false
    })

    expect(first).toEqual({
      type: 'continued',
      phase: 'statuses',
      cursor: 'X',
      pass: 1
    })
    expect(second).toEqual({
      type: 'continued',
      phase: 'statuses',
      cursor: 'X',
      pass: 2
    })
    const row = await database.getAccountImport({
      id: accountImport.id,
      actorId
    })
    expect(parseImportProgress(row?.progress).continuationCount).toBe(2)
    // The queue ids the job would publish differ for the two passes.
    expect(
      getAccountImportContinuationJobId(accountImport.id, 'statuses:X', 1)
    ).not.toBe(
      getAccountImportContinuationJobId(accountImport.id, 'statuses:X', 2)
    )
  })

  it('requeues a stale run with a fresh continuation id on every sweep', async () => {
    const accountImport = await createImportWithItem('import-runner-reap-ids')
    const now = Date.now()
    await database.updateAccountImport({
      id: accountImport.id,
      status: 'running',
      phase: 'statuses',
      cursor: 'X',
      progress: serializeImportProgress({
        ...parseImportProgress(null),
        continuationCount: 0
      })
    })
    const stale = async () => {
      await db
        .updateTable('account_imports')
        .set({
          updatedAt: new Date(now - ACCOUNT_IMPORT_STUCK_AFTER_MS - 1),
          claimedUntil: null
        })
        .where('id', '=', accountImport.id)
        .execute()
    }
    await stale()
    const firstSchedule = vi.fn().mockResolvedValue(undefined)
    expect(
      await sweepStuckAccountImports(database, now, firstSchedule, false)
    ).toBe(1)
    await stale()
    const secondSchedule = vi.fn().mockResolvedValue(undefined)
    expect(
      await sweepStuckAccountImports(database, now, secondSchedule, false)
    ).toBe(1)

    const firstId = firstSchedule.mock.calls[0][0].id
    const secondId = secondSchedule.mock.calls[0][0].id
    expect(firstId).toBe(
      getAccountImportContinuationJobId(accountImport.id, 'statuses:X', 1)
    )
    expect(secondId).toBe(
      getAccountImportContinuationJobId(accountImport.id, 'statuses:X', 2)
    )
    expect(firstId).not.toBe(secondId)
    const row = await database.getAccountImport({
      id: accountImport.id,
      actorId
    })
    expect(parseImportProgress(row?.progress).continuationCount).toBe(2)
  })
})
