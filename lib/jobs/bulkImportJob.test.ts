import { follow, unfollow } from '@/lib/activities'
import type { Db } from '@/lib/database/kysely'
import { Database } from '@/lib/database/types'
import {
  BULK_IMPORT_HEARTBEAT_MS,
  bulkImportJob,
  getBulkImportContinueJobId,
  getBulkImportOverwriteJobId,
  getBulkImportWaitJobId,
  runBulkImport
} from '@/lib/jobs/bulkImportJob'
import { fetchRemoteStatusJob } from '@/lib/jobs/fetchRemoteStatusJob'
import { BULK_IMPORT_JOB_NAME } from '@/lib/jobs/names'
import { resolveAccountTarget } from '@/lib/services/actors/resolveAccountTarget'
import {
  createImportTestDatabase,
  createPublicNote,
  createRemoteActor,
  resolveStoredAccount
} from '@/lib/services/imports/importTestUtils'
import { BulkImportRowData, BulkImportType } from '@/lib/services/imports/types'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { Actor } from '@/lib/types/domain/actor'
import { FollowStatus } from '@/lib/types/domain/follow'

const mockPublish = vi.hoisted(() => vi.fn())
const queueState = vi.hoisted(() => ({ runsInline: false }))

vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({
    publish: mockPublish,
    runsInline: queueState.runsInline
  })
}))
vi.mock('@/lib/activities', () => ({ follow: vi.fn(), unfollow: vi.fn() }))
vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActor: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@/lib/services/actors/resolveAccountTarget', () => ({
  resolveAccountTarget: vi.fn()
}))
vi.mock('@/lib/jobs/fetchRemoteStatusJob', () => ({
  fetchRemoteStatusJob: vi.fn()
}))

const IMPORT_ID = 'import-1'

describe('bulkImportJob', () => {
  let database: Database
  let db: Db
  let actor: Actor
  let bob: Actor
  let carol: Actor

  beforeEach(async () => {
    ;({ database, db, actor } = await createImportTestDatabase())
    queueState.runsInline = false
    bob = await createRemoteActor(database, 'bob')
    carol = await createRemoteActor(database, 'carol')
    mockPublish.mockReset().mockResolvedValue(undefined)
    vi.mocked(follow).mockReset().mockResolvedValue(true)
    vi.mocked(unfollow).mockReset().mockResolvedValue(true)
    vi.mocked(fetchRemoteStatusJob).mockReset()
    vi.mocked(resolveAccountTarget)
      .mockReset()
      .mockImplementation(resolveStoredAccount)
  })

  afterEach(async () => {
    await database.destroy()
  })

  const createImport = async (
    type: BulkImportType,
    rows: BulkImportRowData[],
    overwrite = false
  ) => {
    await database.createBulkImport({
      id: IMPORT_ID,
      actorId: actor.id,
      type,
      overwrite,
      originalFilename: 'file.csv',
      rows
    })
  }

  const getImport = async () =>
    (await database.getBulkImportById({ id: IMPORT_ID }))!

  const followTarget = (target: Actor, status = FollowStatus.enum.Accepted) =>
    database.createFollow({
      actorId: actor.id,
      targetActorId: target.id,
      status,
      inbox: `${actor.id}/inbox`,
      sharedInbox: 'https://test.llun.dev/inbox'
    })

  const activeFollow = (target: Actor) =>
    database.getAcceptedOrRequestedFollow({
      actorId: actor.id,
      targetActorId: target.id
    })

  it('ignores a missing import and malformed data', async () => {
    await bulkImportJob(database, {
      id: 'x',
      name: BULK_IMPORT_JOB_NAME,
      data: { importId: 'missing' }
    })
    await bulkImportJob(database, {
      id: 'x',
      name: BULK_IMPORT_JOB_NAME,
      data: {}
    })
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('finishes an empty import', async () => {
    await createImport('following', [])
    await runBulkImport(database, IMPORT_ID)
    expect(await getImport()).toMatchObject({
      state: 'finished',
      totalItems: 0,
      processedItems: 0
    })
  })

  it('merges: imports what resolves, fails the rest and keeps existing follows', async () => {
    await followTarget(carol)
    await createImport('following', [
      { acct: 'bob@remote.test', show_reblogs: false, notify: true },
      { acct: 'nobody@remote.test' }
    ])

    await runBulkImport(database, IMPORT_ID)

    expect(await getImport()).toMatchObject({
      state: 'finished',
      totalItems: 2,
      processedItems: 2,
      importedItems: 1
    })
    expect(await activeFollow(bob)).toMatchObject({
      reblogs: false,
      notify: true
    })
    expect(await activeFollow(carol)).not.toBeNull()
    const failed = await database.getBulkImportFailedRows({
      importId: IMPORT_ID
    })
    expect(failed).toHaveLength(1)
    expect(failed[0].error).toBe('Account not found')
  })

  it('records a generic error for a row that throws, not its message', async () => {
    vi.mocked(resolveAccountTarget).mockRejectedValueOnce(new Error('boom'))
    await createImport('following', [{ acct: 'bob@remote.test' }])

    await runBulkImport(database, IMPORT_ID)

    const failed = await database.getBulkImportFailedRows({
      importId: IMPORT_ID
    })
    expect(failed[0].error).toBe('Could not import this row')
    expect(await getImport()).toMatchObject({
      state: 'finished',
      processedItems: 1,
      importedItems: 0
    })
  })

  it('overwrites: counts kept follows, removes the rest, imports the new ones', async () => {
    await followTarget(bob)
    await followTarget(carol)
    await createImport(
      'following',
      [{ acct: 'bob@remote.test', notify: true }, { acct: 'dave@remote.test' }],
      true
    )
    await createRemoteActor(database, 'dave')
    const dave = (await database.getActorFromUsername({
      username: 'dave',
      domain: 'remote.test'
    })) as Actor

    await runBulkImport(database, IMPORT_ID)

    expect(await activeFollow(carol)).toBeNull()
    expect(await activeFollow(bob)).toMatchObject({ notify: true })
    expect(await activeFollow(dave)).not.toBeNull()
    expect(await getImport()).toMatchObject({
      state: 'finished',
      overwriteDone: true,
      totalItems: 2,
      processedItems: 2,
      importedItems: 2
    })
  })

  it('finishes an overwrite whose rows the pre-pass consumed entirely', async () => {
    await followTarget(bob)
    await createImport('following', [{ acct: 'bob@remote.test' }], true)

    await runBulkImport(database, IMPORT_ID)

    expect(await getImport()).toMatchObject({
      state: 'finished',
      processedItems: 1,
      importedItems: 1
    })
    expect(follow).not.toHaveBeenCalled()
  })

  it('is idempotent when the whole job runs again', async () => {
    await followTarget(carol)
    await createImport(
      'following',
      [{ acct: 'bob@remote.test' }, { acct: 'nobody@remote.test' }],
      true
    )
    await runBulkImport(database, IMPORT_ID)
    const first = await getImport()

    // A re-delivered job starts from a checkpoint that was never saved.
    await database.updateBulkImport({
      id: IMPORT_ID,
      state: 'scheduled',
      nextRowIndex: 0,
      overwriteDone: false
    })
    await runBulkImport(database, IMPORT_ID)

    const second = await getImport()
    expect(second).toMatchObject({
      state: 'finished',
      totalItems: first.totalItems,
      processedItems: first.processedItems,
      importedItems: first.importedItems
    })
    expect(follow).toHaveBeenCalledTimes(1)
    expect(await activeFollow(bob)).not.toBeNull()
  })

  it('does not duplicate blocks or bookmarks on a repeated run', async () => {
    const uri = `${bob.id}/statuses/1`
    await createPublicNote(database, uri, bob.id)
    await createImport('bookmarks', [{ uri }])
    await runBulkImport(database, IMPORT_ID)
    await database.updateBulkImport({ id: IMPORT_ID, state: 'scheduled' })
    await runBulkImport(database, IMPORT_ID)

    expect(
      await database.getBookmarks({ actorId: actor.id, limit: 10 })
    ).toHaveLength(1)
    expect(await getImport()).toMatchObject({
      processedItems: 1,
      importedItems: 1
    })
  })

  it('imports bookmarks: a remote status is fetched, an unknown local one fails', async () => {
    const remote = `${bob.id}/statuses/remote`
    vi.mocked(fetchRemoteStatusJob).mockImplementation(async () => {
      await createPublicNote(database, remote, bob.id)
    })
    await createImport('bookmarks', [
      { uri: remote },
      { uri: `https://${TEST_DOMAIN}/users/test/statuses/unknown` }
    ])

    await runBulkImport(database, IMPORT_ID)

    expect(await getImport()).toMatchObject({
      state: 'finished',
      processedItems: 2,
      importedItems: 1
    })
    expect(
      (await database.getBookmarks({ actorId: actor.id, limit: 10 })).map(
        (bookmark) => bookmark.statusId
      )
    ).toEqual([remote])
  })

  it('imports blocking rows', async () => {
    await createImport('blocking', [{ acct: 'bob@remote.test' }])
    await runBulkImport(database, IMPORT_ID)
    expect(
      await database.isBlocking({ actorId: actor.id, targetActorId: bob.id })
    ).toBe(true)
  })

  it('imports muting rows', async () => {
    await createImport('muting', [{ acct: 'bob@remote.test' }])
    await runBulkImport(database, IMPORT_ID)
    expect(
      await database.getMute({ actorId: actor.id, targetActorId: bob.id })
    ).not.toBeNull()
  })

  it('imports domain_blocking rows and drops the blocks the file omits', async () => {
    await database.createActorDomainBlock({
      actorId: actor.id,
      domain: 'old.test'
    })
    await createImport('domain_blocking', [{ domain: 'new.test' }], true)
    await runBulkImport(database, IMPORT_ID)
    expect(
      (await database.getActorDomainBlocks({ actorId: actor.id })).map(
        (block) => block.domain
      )
    ).toEqual(['new.test'])
    expect(await getImport()).toMatchObject({
      state: 'finished',
      importedItems: 1
    })
  })

  it('creates the lists of the file by title and fills them', async () => {
    const existing = await database.createList({
      actorId: actor.id,
      title: 'Existing'
    })
    await createImport('lists', [
      { list_name: 'Existing', acct: 'bob@remote.test' },
      { list_name: 'New', acct: 'bob@remote.test' },
      { list_name: 'New', acct: 'carol@remote.test' }
    ])

    await runBulkImport(database, IMPORT_ID)

    const lists = await database.getLists({ actorId: actor.id })
    expect(lists.map((list) => list.title).sort()).toEqual(['Existing', 'New'])
    const created = lists.find((list) => list.title === 'New')!
    expect(created.id).not.toBe(existing.id)
    const membersOf = async (listId: string) =>
      (await database.getListMembers({ listId, actorId: actor.id }))
        .map((member) => member.targetActorId)
        .sort()
    expect(await membersOf(existing.id)).toEqual([bob.id])
    expect(await membersOf(created.id)).toEqual([bob.id, carol.id].sort())
    expect(await getImport()).toMatchObject({
      state: 'finished',
      processedItems: 3,
      importedItems: 3
    })
  })

  it('overwrites lists: drops the ones missing from the file and refills the rest', async () => {
    const keep = await database.createList({ actorId: actor.id, title: 'Keep' })
    await database.createList({ actorId: actor.id, title: 'Drop' })
    await followTarget(bob)
    await database.addListAccounts({
      listId: keep.id,
      actorId: actor.id,
      targetActorIds: [bob.id]
    })
    await createImport(
      'lists',
      [{ list_name: 'Keep', acct: 'carol@remote.test' }],
      true
    )

    await runBulkImport(database, IMPORT_ID)

    const lists = await database.getLists({ actorId: actor.id })
    expect(lists.map((list) => list.title)).toEqual(['Keep'])
    expect(
      (
        await database.getListMembers({ listId: keep.id, actorId: actor.id })
      ).map((member) => member.targetActorId)
    ).toEqual([carol.id])
  })

  it('hands over to a deterministic continuation when the budget is spent and resumes from nextRowIndex', async () => {
    await createImport('blocking', [
      { acct: 'bob@remote.test' },
      { acct: 'carol@remote.test' },
      { acct: 'nobody@remote.test' }
    ])

    // The budget is checked after every row, so a page of 2 stops after 1.
    await runBulkImport(database, IMPORT_ID, { budgetMs: -1, pageSize: 2 })

    expect(
      mockPublish.mock.calls.filter(
        ([message]) => message.name === BULK_IMPORT_JOB_NAME
      )
    ).toHaveLength(1)
    expect(mockPublish).toHaveBeenCalledWith({
      id: getBulkImportContinueJobId(IMPORT_ID, 1),
      name: BULK_IMPORT_JOB_NAME,
      data: { importId: IMPORT_ID }
    })
    expect(await getImport()).toMatchObject({
      state: 'in_progress',
      nextRowIndex: 1,
      processedItems: 1
    })

    mockPublish.mockClear()
    await runBulkImport(database, IMPORT_ID, { pageSize: 2 })

    expect(
      mockPublish.mock.calls.filter(
        ([message]) => message.name === BULK_IMPORT_JOB_NAME
      )
    ).toHaveLength(0)
    expect(await getImport()).toMatchObject({
      state: 'finished',
      processedItems: 3,
      importedItems: 2
    })
  })

  describe('run claim', () => {
    const jobMessages = () =>
      mockPublish.mock.calls
        .map(([message]) => message)
        .filter((message) => message.name === BULK_IMPORT_JOB_NAME)

    it('does nothing when another run holds the claim and republishes a delayed wait job', async () => {
      await createImport('blocking', [{ acct: 'bob@remote.test' }])
      await database.claimBulkImportRun({
        id: IMPORT_ID,
        runToken: 'other-run',
        leaseMs: 60_000
      })
      const held = (await database.claimBulkImportRun({
        id: IMPORT_ID,
        runToken: 'probe',
        leaseMs: 1
      })) as { claimed: false; runToken: string; claimedUntil: number }
      expect(held.runToken).toBe('other-run')
      const holder = {
        runToken: held.runToken,
        claimedUntil: held.claimedUntil
      }

      await runBulkImport(database, IMPORT_ID)

      expect(await getImport()).toMatchObject({
        state: 'scheduled',
        processedItems: 0
      })
      expect(
        await database.isBlocking({ actorId: actor.id, targetActorId: bob.id })
      ).toBe(false)
      expect(jobMessages()).toEqual([
        {
          id: getBulkImportWaitJobId(IMPORT_ID, holder),
          name: BULK_IMPORT_JOB_NAME,
          data: { importId: IMPORT_ID, waitedFor: holder },
          delaySeconds: expect.any(Number)
        }
      ])
      // The lease has about a minute left; wait for that, plus a little.
      const { delaySeconds } = jobMessages()[0]
      expect(delaySeconds).toBeGreaterThan(55)
      expect(delaySeconds).toBeLessThan(70)
    })

    describe('wait jobs', () => {
      const holdClaim = async () => {
        await createImport('blocking', [{ acct: 'bob@remote.test' }])
        await database.claimBulkImportRun({
          id: IMPORT_ID,
          runToken: 'other-run',
          leaseMs: 60_000
        })
        const { runToken, claimedUntil } = (await database.claimBulkImportRun({
          id: IMPORT_ID,
          runToken: 'probe',
          leaseMs: 1
        })) as { runToken: string; claimedUntil: number }
        return { runToken, claimedUntil }
      }

      it('does not republish when another holder has the claim', async () => {
        const holder = await holdClaim()

        await runBulkImport(database, IMPORT_ID, {
          waitedFor: {
            runToken: 'earlier-run',
            claimedUntil: holder.claimedUntil
          }
        })

        expect(jobMessages()).toEqual([])
        expect(await getImport()).toMatchObject({ processedItems: 0 })
      })

      it('reads the claim it waited for from its job data', async () => {
        const holder = await holdClaim()

        await bulkImportJob(database, {
          id: `${IMPORT_ID}:wait:1`,
          name: BULK_IMPORT_JOB_NAME,
          data: {
            importId: IMPORT_ID,
            waitedFor: { runToken: 'earlier-run', claimedUntil: 1 }
          }
        })
        expect(jobMessages()).toEqual([])

        await bulkImportJob(database, {
          id: `${IMPORT_ID}:wait:2`,
          name: BULK_IMPORT_JOB_NAME,
          data: { importId: IMPORT_ID, waitedFor: holder }
        })
        expect(jobMessages()).toHaveLength(1)
      })

      it('keeps waiting for a holder that renewed its lease, under an id of the new lease', async () => {
        const queued = await holdClaim()
        // The holder works on: its lease moves, its token does not.
        await database.renewBulkImportRun({
          id: IMPORT_ID,
          runToken: 'other-run',
          leaseMs: 120_000
        })
        const renewed = (await database.claimBulkImportRun({
          id: IMPORT_ID,
          runToken: 'probe',
          leaseMs: 1
        })) as { claimedUntil: number }
        expect(renewed.claimedUntil).toBeGreaterThan(queued.claimedUntil)

        await runBulkImport(database, IMPORT_ID, { waitedFor: queued })

        expect(jobMessages()).toEqual([
          {
            id: getBulkImportWaitJobId(IMPORT_ID, {
              runToken: 'other-run',
              claimedUntil: renewed.claimedUntil
            }),
            name: BULK_IMPORT_JOB_NAME,
            data: {
              importId: IMPORT_ID,
              waitedFor: {
                runToken: 'other-run',
                claimedUntil: renewed.claimedUntil
              }
            },
            delaySeconds: expect.any(Number)
          }
        ])
        expect(jobMessages()[0].delaySeconds).toBeGreaterThan(115)
      })

      it('republishes exactly one delayed wait when the same claim is still live', async () => {
        const holder = await holdClaim()

        await runBulkImport(database, IMPORT_ID, { waitedFor: holder })

        expect(jobMessages()).toEqual([
          {
            id: getBulkImportWaitJobId(IMPORT_ID, holder),
            name: BULK_IMPORT_JOB_NAME,
            data: { importId: IMPORT_ID, waitedFor: holder },
            delaySeconds: expect.any(Number)
          }
        ])
        expect(jobMessages()[0].delaySeconds).toBeGreaterThan(55)
      })

      it('finishes the import after a holder that renewed and then died', async () => {
        await createImport('blocking', [{ acct: 'bob@remote.test' }])
        // H1 holds the import, and the queue retry R finds it live and waits.
        await database.claimBulkImportRun({
          id: IMPORT_ID,
          runToken: 'h1',
          leaseMs: 30_000
        })
        await runBulkImport(database, IMPORT_ID)
        expect(jobMessages()).toHaveLength(1)
        const first = jobMessages()[0]
        // H1 renews (its lease moves past the one R waited for), then dies
        // without releasing.
        await database.renewBulkImportRun({
          id: IMPORT_ID,
          runToken: 'h1',
          leaseMs: 90_000
        })

        // The first wait lands: the same holder is still live, so one more
        // wait is queued rather than the import being dropped.
        mockPublish.mockClear()
        await bulkImportJob(database, { ...first, data: first.data })
        expect(jobMessages()).toHaveLength(1)
        const second = jobMessages()[0]
        expect(second.id).not.toBe(first.id)
        expect(await getImport()).toMatchObject({ processedItems: 0 })

        // The lease lapses with nobody renewing it; the next wait claims.
        await db
          .updateTable('bulk_imports')
          .set({ claimedUntil: new Date(Date.now() - 1000) })
          .where('id', '=', IMPORT_ID)
          .execute()
        mockPublish.mockClear()
        await bulkImportJob(database, { ...second, data: second.data })

        expect(await getImport()).toMatchObject({
          state: 'finished',
          processedItems: 1,
          importedItems: 1
        })
        expect(
          await database.isBlocking({
            actorId: actor.id,
            targetActorId: bob.id
          })
        ).toBe(true)
      })
    })

    it('stops without checkpointing, marking or publishing when another run took the lease mid-run', async () => {
      await createImport('blocking', [
        { acct: 'bob@remote.test' },
        { acct: 'carol@remote.test' },
        { acct: 'nobody@remote.test' }
      ])
      const mark = database.markBulkImportRowProcessed.bind(database)
      vi.spyOn(database, 'markBulkImportRowProcessed').mockImplementation(
        async (params) => {
          const marked = await mark(params)
          // The lease lapsed and another run claimed the import.
          await db
            .updateTable('bulk_imports')
            .set({ runToken: 'thief' })
            .where('id', '=', IMPORT_ID)
            .execute()
          return marked
        }
      )

      await runBulkImport(database, IMPORT_ID, { pageSize: 2 })

      expect(await getImport()).toMatchObject({
        state: 'in_progress',
        processedItems: 1,
        nextRowIndex: 0
      })
      expect(
        await database.isBlocking({ actorId: actor.id, targetActorId: bob.id })
      ).toBe(true)
      expect(jobMessages()).toEqual([])
      // The thief's claim is untouched by this run's release.
      expect(
        await database.claimBulkImportRun({
          id: IMPORT_ID,
          runToken: 'next',
          leaseMs: 1000
        })
      ).toMatchObject({ claimed: false })
    })

    it('writes no lastError when it fails after losing the lease', async () => {
      await createImport('blocking', [{ acct: 'bob@remote.test' }])
      vi.spyOn(database, 'markBulkImportRowProcessed').mockImplementation(
        async () => {
          await db
            .updateTable('bulk_imports')
            .set({ runToken: 'thief' })
            .where('id', '=', IMPORT_ID)
            .execute()
          throw new Error('db down')
        }
      )

      // The thief owns the import (and its error state): this run just stops.
      await runBulkImport(database, IMPORT_ID)

      expect((await getImport()).lastError).toBeNull()
      expect(jobMessages()).toEqual([])
    })

    describe('heartbeat', () => {
      // A unit of work the test holds open, with only the timers it needs faked.
      const startBlockedRun = async (
        rows: BulkImportRowData[] = [{ acct: 'bob@remote.test' }]
      ) => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
        vi.spyOn(database, 'renewBulkImportRun')
        await createImport('following', rows)
        let finishUnit!: () => void
        let reached!: () => void
        const unitReached = new Promise<void>((resolve) => (reached = resolve))
        vi.mocked(follow).mockImplementation(
          () =>
            new Promise((resolve) => {
              finishUnit = () => resolve(true)
              reached()
            })
        )
        const run = runBulkImport(database, IMPORT_ID)
        // Resolves only once the run is inside the unit: no polling budget.
        await unitReached
        return { run, finishUnit: () => finishUnit() }
      }
      // Real I/O finishes outside the fake clock: wait for every renewal the
      // heartbeat started, not for a number of event-loop turns.
      const settle = async () => {
        await Promise.allSettled(
          vi
            .mocked(database.renewBulkImportRun)
            .mock.results.map((result) => result.value)
        )
      }
      const tick = async (ms: number) => {
        await vi.advanceTimersByTimeAsync(ms)
        await settle()
      }

      afterEach(() => {
        vi.useRealTimers()
      })

      it('keeps the lease through a unit longer than the lease', async () => {
        const { run, finishUnit } = await startBlockedRun()

        // Twice the 35s lease; only the heartbeat renews it.
        for (let i = 0; i < 7; i += 1) await tick(BULK_IMPORT_HEARTBEAT_MS)
        expect(
          await database.claimBulkImportRun({
            id: IMPORT_ID,
            runToken: 'rival',
            leaseMs: 1000
          })
        ).toMatchObject({ claimed: false })

        finishUnit()
        await settle()
        await run
        expect(await getImport()).toMatchObject({
          state: 'finished',
          processedItems: 1
        })
        // The timer does not outlive the run.
        expect(vi.getTimerCount()).toBe(0)
      })

      const expectNothingWritten = async () => {
        expect(await getImport()).toMatchObject({
          processedItems: 0,
          nextRowIndex: 0,
          lastError: null
        })
        expect(jobMessages()).toEqual([])
        expect(vi.getTimerCount()).toBe(0)
      }

      it('stops quietly, without checkpointing, marking or publishing, when a renewal changes no row', async () => {
        const renew = vi.spyOn(database, 'renewBulkImportRun')
        const { run, finishUnit } = await startBlockedRun()
        try {
          renew.mockResolvedValueOnce(false)

          // The heartbeat is the only renewal while the unit is open.
          await tick(BULK_IMPORT_HEARTBEAT_MS)
          expect(renew).toHaveBeenCalledTimes(1)

          finishUnit()
          await settle()
          await run
          await expectNothingWritten()
        } finally {
          finishUnit()
          await settle()
          await run.catch(() => undefined)
        }
      })

      it.each([
        ['15 minutes', 20 * 60 * 1000],
        ['24 hours', 25 * 60 * 60 * 1000]
      ])(
        'stops a suspended holder that resumes after its import was abandoned (%s idle)',
        async (_name, idleMs) => {
          const { run, finishUnit } = await startBlockedRun([
            { acct: 'bob@remote.test' },
            { acct: 'carol@remote.test' }
          ])
          // Mid-unit, the actor starts a new import; the idle one is abandoned.
          await db
            .updateTable('bulk_imports')
            .set({
              updatedAt: new Date(Date.now() - idleMs),
              claimedUntil: new Date(Date.now() - 1000)
            })
            .where('id', '=', IMPORT_ID)
            .execute()
          expect(
            await database.createBulkImport({
              id: 'import-2',
              actorId: actor.id,
              type: 'following',
              overwrite: false,
              originalFilename: 'new.csv',
              rows: [{ acct: 'dave@remote.test' }]
            })
          ).not.toBeNull()

          const mark = vi.spyOn(database, 'markBulkImportRowProcessed')
          finishUnit()
          await settle()
          await run

          // Only the in-flight row's follow; nothing marked, queued or followed.
          expect(follow).toHaveBeenCalledTimes(1)
          expect(mark).not.toHaveBeenCalled()
          expect(jobMessages()).toEqual([])
          expect(await getImport()).toMatchObject({
            state: 'finished',
            lastError: 'Abandoned: no progress',
            processedItems: 0
          })
          expect(vi.getTimerCount()).toBe(0)
        }
      )

      it('carries on when a heartbeat renewal throws once: the next renewal re-checks the lease', async () => {
        const renew = vi.spyOn(database, 'renewBulkImportRun')
        const { run, finishUnit } = await startBlockedRun()
        renew.mockRejectedValueOnce(new Error('db down'))
        try {
          await tick(BULK_IMPORT_HEARTBEAT_MS)
          expect(renew).toHaveBeenCalledTimes(1)

          finishUnit()
          await settle()
          await run
          expect(await getImport()).toMatchObject({
            state: 'finished',
            processedItems: 1,
            lastError: null
          })
          expect(vi.getTimerCount()).toBe(0)
        } finally {
          finishUnit()
          await settle()
          await run.catch(() => undefined)
        }
      })

      it('fails the run with the renewal error, writing and publishing nothing, when the main path renewal throws', async () => {
        const renew = vi.spyOn(database, 'renewBulkImportRun')
        const { run, finishUnit } = await startBlockedRun()
        const outcome = expect(run).rejects.toThrow('db down')
        try {
          // The heartbeat renews the unit (really), the main path's own throws.
          await tick(BULK_IMPORT_HEARTBEAT_MS)
          expect(renew).toHaveBeenCalledTimes(1)
          renew.mockRejectedValueOnce(new Error('db down'))

          finishUnit()
          await settle()
          await outcome
          await expectNothingWritten()
          // The claim is released so the queue's retry can take the import.
          expect(
            await database.claimBulkImportRun({
              id: IMPORT_ID,
              runToken: 'retry',
              leaseMs: 1000
            })
          ).toEqual({ claimed: true })
        } finally {
          finishUnit()
          await settle()
          await run.catch(() => undefined)
        }
      })
    })

    it('does not publish a continuation or checkpoint when the lease is lost at the budget', async () => {
      await createImport('blocking', [
        { acct: 'bob@remote.test' },
        { acct: 'carol@remote.test' }
      ])
      vi.spyOn(database, 'renewBulkImportRun').mockResolvedValue(false)

      await runBulkImport(database, IMPORT_ID, { budgetMs: -1, pageSize: 1 })

      expect(jobMessages()).toEqual([])
      expect(await getImport()).toMatchObject({
        processedItems: 0,
        nextRowIndex: 0
      })
    })

    it('runs to completion in one go under an inline queue', async () => {
      queueState.runsInline = true
      await createImport('blocking', [
        { acct: 'bob@remote.test' },
        { acct: 'carol@remote.test' },
        { acct: 'nobody@remote.test' }
      ])

      // Any other queue would stop after the first row on this budget.
      await runBulkImport(database, IMPORT_ID, { budgetMs: -1, pageSize: 1 })

      expect(jobMessages()).toEqual([])
      expect(await getImport()).toMatchObject({
        state: 'finished',
        processedItems: 3,
        importedItems: 2
      })
    })

    it('releases the claim before it publishes the continuation', async () => {
      await createImport('blocking', [
        { acct: 'bob@remote.test' },
        { acct: 'carol@remote.test' }
      ])
      let claimedDuringPublish: boolean | undefined
      let claimedDuringRow: boolean | undefined
      mockPublish.mockImplementation(async (message) => {
        if (message.name !== BULK_IMPORT_JOB_NAME) {
          // The block job a row publishes: the run still holds the claim.
          claimedDuringRow ??= (
            await database.claimBulkImportRun({
              id: IMPORT_ID,
              runToken: 'probe',
              leaseMs: 1000
            })
          ).claimed
          return
        }
        const result = await database.claimBulkImportRun({
          id: IMPORT_ID,
          runToken: 'next-run',
          leaseMs: 1000
        })
        claimedDuringPublish = result.claimed
      })

      await runBulkImport(database, IMPORT_ID, { budgetMs: -1, pageSize: 1 })

      expect(claimedDuringRow).toBe(false)
      expect(claimedDuringPublish).toBe(true)
    })

    it('releases the claim when the run fails', async () => {
      await createImport('blocking', [{ acct: 'bob@remote.test' }])
      let claimedWhileRunning: boolean | undefined
      vi.spyOn(database, 'markBulkImportRowProcessed').mockImplementationOnce(
        async () => {
          claimedWhileRunning = (
            await database.claimBulkImportRun({
              id: IMPORT_ID,
              runToken: 'probe',
              leaseMs: 1000
            })
          ).claimed
          throw new Error('db down')
        }
      )

      await expect(runBulkImport(database, IMPORT_ID)).rejects.toThrow(
        'db down'
      )

      expect(claimedWhileRunning).toBe(false)

      expect(
        await database.claimBulkImportRun({
          id: IMPORT_ID,
          runToken: 'retry',
          leaseMs: 1000
        })
      ).toEqual({ claimed: true })
    })

    it('processes each row once and creates one list per title when two runs overlap', async () => {
      await createImport('lists', [
        { list_name: 'Friends', acct: 'bob@remote.test' },
        { list_name: 'Friends', acct: 'carol@remote.test' },
        { list_name: 'Work', acct: 'bob@remote.test' }
      ])

      await Promise.all([
        runBulkImport(database, IMPORT_ID),
        runBulkImport(database, IMPORT_ID)
      ])

      const lists = await database.getLists({ actorId: actor.id })
      expect(lists.map((list) => list.title).sort()).toEqual([
        'Friends',
        'Work'
      ])
      expect(await getImport()).toMatchObject({
        state: 'finished',
        processedItems: 3,
        importedItems: 3
      })
      // bob is followed once for two rows, carol once.
      expect(follow).toHaveBeenCalledTimes(2)
      // The run that lost the claim only queued a wait job.
      expect(
        jobMessages().filter((message) => message.id.includes(':wait:'))
      ).toHaveLength(1)
    })
  })

  describe('lists', () => {
    it('does not clear members the row pass added when a failed run is retried', async () => {
      const keep = await database.createList({
        actorId: actor.id,
        title: 'Keep'
      })
      await followTarget(bob)
      await database.addListAccounts({
        listId: keep.id,
        actorId: actor.id,
        targetActorIds: [bob.id]
      })
      await createImport(
        'lists',
        [
          { list_name: 'Keep', acct: 'carol@remote.test' },
          { list_name: 'Keep', acct: 'dave@remote.test' }
        ],
        true
      )
      await createRemoteActor(database, 'dave')
      const processed = database.markBulkImportRowProcessed.bind(database)
      const spy = vi
        .spyOn(database, 'markBulkImportRowProcessed')
        .mockImplementation(async (params) => {
          if (params.rowId.endsWith(':1')) throw new Error('db down')
          return processed(params)
        })

      await expect(runBulkImport(database, IMPORT_ID)).rejects.toThrow()
      const removeSpy = vi.spyOn(database, 'removeListAccounts')
      spy.mockImplementation(processed)
      await runBulkImport(database, IMPORT_ID)

      expect(removeSpy).not.toHaveBeenCalled()
      expect(
        (await database.getListMembers({ listId: keep.id, actorId: actor.id }))
          .map((member) => member.targetActorId)
          .sort()
      ).toContain(carol.id)
      expect(await getImport()).toMatchObject({
        state: 'finished',
        overwriteDone: true,
        processedItems: 2
      })
    })

    it('creates the lists once, not on every continuation', async () => {
      await createImport('lists', [
        { list_name: 'Friends', acct: 'bob@remote.test' },
        { list_name: 'Friends', acct: 'carol@remote.test' }
      ])
      const createList = vi.spyOn(database, 'createList')

      await runBulkImport(database, IMPORT_ID, { budgetMs: -1, pageSize: 1 })
      expect(await getImport()).toMatchObject({ listsPrepared: true })
      await runBulkImport(database, IMPORT_ID, { pageSize: 1 })

      expect(createList).toHaveBeenCalledTimes(1)
      expect(await getImport()).toMatchObject({
        state: 'finished',
        importedItems: 2
      })
    })

    it('fails the rows of an over-long or uncreatable list name and finishes the import', async () => {
      const tooLong = 'x'.repeat(300)
      await createImport('lists', [
        { list_name: tooLong, acct: 'bob@remote.test' },
        { list_name: 'Boom', acct: 'bob@remote.test' },
        { list_name: 'Good', acct: 'bob@remote.test' }
      ])
      const create = database.createList.bind(database)
      const createList = vi
        .spyOn(database, 'createList')
        .mockImplementation(async (params) => {
          // PostgreSQL's varchar(255) error, which SQLite does not raise.
          if (params.title === 'Boom') throw new Error('value too long')
          return create(params)
        })

      await runBulkImport(database, IMPORT_ID)

      expect(createList.mock.calls.map(([params]) => params.title)).toEqual([
        'Boom',
        'Good'
      ])
      const failed = await database.getBulkImportFailedRows({
        importId: IMPORT_ID
      })
      expect(failed.map((row) => [row.rowIndex, row.error])).toEqual([
        [0, 'Invalid list name'],
        [1, 'List not found']
      ])
      expect(await getImport()).toMatchObject({
        state: 'finished',
        processedItems: 3,
        importedItems: 1
      })
    })
  })

  describe('overwrite pre-pass', () => {
    it('checkpoints under a tiny budget, continues in later runs and then runs the rows', async () => {
      const dave = await createRemoteActor(database, 'dave')
      const erin = await createRemoteActor(database, 'erin')
      await followTarget(bob)
      await followTarget(carol)
      await followTarget(dave)
      await followTarget(erin)
      await createImport('following', [{ acct: 'bob@remote.test' }], true)

      await runBulkImport(database, IMPORT_ID, { budgetMs: -1 })

      expect(await getImport()).toMatchObject({
        state: 'in_progress',
        overwriteDone: false,
        overwriteProgress: 1
      })
      expect(mockPublish).toHaveBeenCalledWith({
        id: getBulkImportOverwriteJobId(IMPORT_ID, 1),
        name: BULK_IMPORT_JOB_NAME,
        data: { importId: IMPORT_ID }
      })
      expect(unfollow).toHaveBeenCalledTimes(1)

      mockPublish.mockClear()
      await runBulkImport(database, IMPORT_ID, { budgetMs: -1 })
      expect(await getImport()).toMatchObject({
        overwriteDone: false,
        overwriteProgress: 2
      })
      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({
          id: getBulkImportOverwriteJobId(IMPORT_ID, 2)
        })
      )
      expect(unfollow).toHaveBeenCalledTimes(2)

      mockPublish.mockClear()
      await runBulkImport(database, IMPORT_ID)
      expect(mockPublish).not.toHaveBeenCalled()
      expect(await getImport()).toMatchObject({
        state: 'finished',
        overwriteDone: true,
        processedItems: 1,
        importedItems: 1
      })
      expect(await activeFollow(bob)).not.toBeNull()
      expect(await activeFollow(carol)).toBeNull()
      expect(await activeFollow(dave)).toBeNull()
      expect(await activeFollow(erin)).toBeNull()
      expect(unfollow).toHaveBeenCalledTimes(3)
    })
  })
})
