import {
  createSearchActor,
  seedStatus
} from '@/lib/database/sql/searchTestHelpers'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

const DOMAIN = 'wiq.test'
const T0 = Date.parse('2026-03-01T00:00:00.000Z')

// Each test builds its own actors, imports and histories, and keeps a
// neighbouring row (another actor's, another provider user's or another
// history's) that the query under test must leave alone.
describe('wahoo import queries', () => {
  const testDb = createTestDatabase()
  const { database, db } = testDb

  let actorCount = 0
  const newActor = async () => {
    actorCount += 1
    const username = `wiq${actorCount}`
    const id = `https://${DOMAIN}/users/${username}`
    await createSearchActor(database, { id, username, domain: DOMAIN })
    return id
  }

  const rawImport = (id: string) =>
    db
      .selectFrom('wahoo_imports')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow()

  const rawHistory = (id: string) =>
    db
      .selectFrom('wahoo_history_imports')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow()

  const at = (offsetMs: number) => vi.setSystemTime(new Date(T0 + offsetMs))

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    at(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  afterAll(async () => {
    await database.destroy()
  })

  describe('upsertWahooImport', () => {
    it('keeps one import per actor, provider user and workout', async () => {
      const actor = await newActor()
      const otherActor = await newActor()
      const neighbours = [
        // Same provider user and workout, other actor.
        await database.upsertWahooImport({
          actorId: otherActor,
          providerUserId: 'p1',
          workoutId: 'w1'
        }),
        // Same actor and workout, other provider user.
        await database.upsertWahooImport({
          actorId: actor,
          providerUserId: 'p2',
          workoutId: 'w1'
        }),
        // Same actor and provider user, other workout.
        await database.upsertWahooImport({
          actorId: actor,
          providerUserId: 'p1',
          workoutId: 'w2'
        })
      ]

      const created = await database.upsertWahooImport({
        actorId: actor,
        providerUserId: 'p1',
        workoutId: 'w1'
      })

      expect(created.created).toBe(true)
      expect(created).toMatchObject({
        actorId: actor,
        providerUserId: 'p1',
        workoutId: 'w1'
      })
      expect(neighbours.every((item) => item.created)).toBe(true)
      expect(
        new Set([created, ...neighbours].map((item) => item.id)).size
      ).toBe(4)

      // The same triple finds that import again, whichever neighbours exist.
      const again = await database.upsertWahooImport({
        actorId: actor,
        providerUserId: 'p1',
        workoutId: 'w1'
      })
      expect(again).toMatchObject({ id: created.id, created: false })
    })

    it('stores a new import as pending with its summary', async () => {
      const actor = await newActor()
      const summaryUpdatedAt = Date.parse('2026-02-03T04:05:06.789Z')

      const created = await database.upsertWahooImport({
        actorId: actor,
        providerUserId: 'p',
        workoutId: 'w',
        summaryId: 's1',
        summaryUpdatedAt
      })

      expect(created).toEqual({
        id: created.id,
        actorId: actor,
        providerUserId: 'p',
        workoutId: 'w',
        summaryId: 's1',
        summaryUpdatedAt,
        fitnessFileId: undefined,
        statusId: undefined,
        historyImportId: undefined,
        status: 'pending',
        hadStatus: false,
        attempts: 0,
        lastError: undefined,
        created: true
      })
      const raw = await rawImport(created.id)
      expect(raw).toMatchObject({
        summaryUpdatedAt,
        createdAt: T0,
        updatedAt: T0
      })
      const bare = await database.upsertWahooImport({
        actorId: actor,
        providerUserId: 'p',
        workoutId: 'w-bare'
      })
      expect(bare.summaryId).toBeUndefined()
      expect(bare.summaryUpdatedAt).toBeUndefined()
      expect((await rawImport(bare.id)).summaryUpdatedAt).toBeNull()
    })

    it('returns the existing import without rewriting it', async () => {
      const actor = await newActor()
      const first = await database.upsertWahooImport({
        actorId: actor,
        providerUserId: 'p',
        workoutId: 'w',
        summaryId: 'first'
      })
      await database.updateWahooImport(first.id, {
        status: 'running',
        attempts: 2
      })
      const before = await rawImport(first.id)
      at(5000)

      const again = await database.upsertWahooImport({
        actorId: actor,
        providerUserId: 'p',
        workoutId: 'w',
        summaryId: 'second',
        summaryUpdatedAt: T0
      })

      expect(again).toMatchObject({
        id: first.id,
        created: false,
        summaryId: 'first',
        status: 'running',
        attempts: 2
      })
      expect(await rawImport(first.id)).toEqual(before)
    })

    it('moves an existing import into a history and leaves its neighbours alone', async () => {
      const actor = await newActor()
      const history = await database.createWahooHistoryImport({
        actorId: actor,
        providerUserId: 'p',
        fromDate: '2026-01-01',
        toDate: '2026-01-31'
      })
      const otherHistory = await database.createWahooHistoryImport({
        actorId: actor,
        providerUserId: 'p',
        fromDate: '2026-02-01',
        toDate: '2026-02-28'
      })
      const neighbour = await database.upsertWahooImport({
        actorId: actor,
        providerUserId: 'p',
        workoutId: 'neighbour',
        historyImportId: otherHistory.id
      })
      const target = await database.upsertWahooImport({
        actorId: actor,
        providerUserId: 'p',
        workoutId: 'target'
      })
      const neighbourBefore = await rawImport(neighbour.id)
      at(7000)

      const linked = await database.upsertWahooImport({
        actorId: actor,
        providerUserId: 'p',
        workoutId: 'target',
        historyImportId: history.id
      })

      expect(linked).toMatchObject({
        id: target.id,
        created: false,
        historyImportId: history.id
      })
      expect(await rawImport(target.id)).toMatchObject({
        historyImportId: history.id,
        updatedAt: T0 + 7000
      })
      expect(await rawImport(neighbour.id)).toEqual(neighbourBefore)

      // The same history again changes nothing.
      at(9000)
      await database.upsertWahooImport({
        actorId: actor,
        providerUserId: 'p',
        workoutId: 'target',
        historyImportId: history.id
      })
      expect((await rawImport(target.id)).updatedAt).toBe(T0 + 7000)
    })
  })

  describe('getWahooImport', () => {
    it('returns the import with that id', async () => {
      const actor = await newActor()
      const first = await database.upsertWahooImport({
        actorId: actor,
        providerUserId: 'p',
        workoutId: 'first'
      })
      const second = await database.upsertWahooImport({
        actorId: actor,
        providerUserId: 'p',
        workoutId: 'second'
      })

      expect(await database.getWahooImport(second.id)).toMatchObject({
        id: second.id,
        workoutId: 'second'
      })
      expect(await database.getWahooImport(first.id)).toMatchObject({
        workoutId: 'first'
      })
      expect(await database.getWahooImport('missing')).toBeNull()
    })
  })

  describe('getWahooImportsByActor', () => {
    it('lists that actor’s imports in the given statuses, newest update first', async () => {
      const actor = await newActor()
      const otherActor = await newActor()
      const make = async (
        owner: string,
        workoutId: string,
        status: 'pending' | 'running' | 'completed' | 'failed' | 'unsupported',
        offset: number
      ) => {
        at(offset)
        const created = await database.upsertWahooImport({
          actorId: owner,
          providerUserId: 'p',
          workoutId
        })
        await database.updateWahooImport(created.id, { status })
        return created.id
      }
      await make(otherActor, 'other-failed', 'failed', 100)
      const oldFailed = await make(actor, 'old-failed', 'failed', 200)
      await make(actor, 'completed', 'completed', 300)
      const unsupported = await make(actor, 'unsupported', 'unsupported', 400)
      await make(otherActor, 'other-unsupported', 'unsupported', 500)
      const newFailed = await make(actor, 'new-failed', 'failed', 600)

      const listed = await database.getWahooImportsByActor({
        actorId: actor,
        statuses: ['failed', 'unsupported']
      })

      expect(listed.map((item) => item.id)).toEqual([
        newFailed,
        unsupported,
        oldFailed
      ])
      expect(
        (
          await database.getWahooImportsByActor({
            actorId: actor,
            statuses: ['failed', 'unsupported'],
            limit: 2
          })
        ).map((item) => item.id)
      ).toEqual([newFailed, unsupported])
      expect(
        await database.getWahooImportsByActor({ actorId: actor, statuses: [] })
      ).toEqual([])
      expect(
        await database.getWahooImportsByActor({
          actorId: actor,
          statuses: ['running']
        })
      ).toEqual([])
    })

    it('returns at most 25 imports by default', async () => {
      const actor = await newActor()
      for (let index = 0; index < 27; index += 1) {
        at(index * 10)
        await database.upsertWahooImport({
          actorId: actor,
          providerUserId: 'p',
          workoutId: `bulk-${index}`
        })
      }

      const listed = await database.getWahooImportsByActor({
        actorId: actor,
        statuses: ['pending']
      })

      expect(listed).toHaveLength(25)
      expect(listed[0].workoutId).toBe('bulk-26')
    })
  })

  describe('updateWahooImport', () => {
    it('changes only that import and only the given fields', async () => {
      const actor = await newActor()
      const neighbour = await database.upsertWahooImport({
        actorId: actor,
        providerUserId: 'p',
        workoutId: 'neighbour',
        summaryId: 'n'
      })
      const target = await database.upsertWahooImport({
        actorId: actor,
        providerUserId: 'p',
        workoutId: 'target',
        summaryId: 'keep-me'
      })
      const neighbourBefore = await rawImport(neighbour.id)
      at(3000)
      const summaryUpdatedAt = Date.parse('2026-01-02T03:04:05.678Z')

      await database.updateWahooImport(target.id, {
        status: 'failed',
        attempts: 3,
        lastError: 'boom',
        summaryUpdatedAt
      })

      expect(await database.getWahooImport(target.id)).toMatchObject({
        status: 'failed',
        attempts: 3,
        lastError: 'boom',
        summaryId: 'keep-me',
        summaryUpdatedAt,
        hadStatus: false
      })
      expect(await rawImport(target.id)).toMatchObject({ updatedAt: T0 + 3000 })
      expect(await rawImport(neighbour.id)).toEqual(neighbourBefore)

      // `undefined` leaves a field alone, `null` clears an error.
      await database.updateWahooImport(target.id, {
        status: undefined,
        lastError: null
      })
      expect(await database.getWahooImport(target.id)).toMatchObject({
        status: 'failed',
        lastError: undefined
      })
    })

    it('remembers that a status was attached', async () => {
      const actor = await newActor()
      const statusId = await seedStatus(db, {
        id: `${actor}/statuses/1`,
        actorId: actor,
        createdAt: T0
      })
      const neighbour = await database.upsertWahooImport({
        actorId: actor,
        providerUserId: 'p',
        workoutId: 'neighbour'
      })
      const target = await database.upsertWahooImport({
        actorId: actor,
        providerUserId: 'p',
        workoutId: 'target'
      })

      await database.updateWahooImport(target.id, { statusId })

      expect(await database.getWahooImport(target.id)).toMatchObject({
        statusId,
        hadStatus: true
      })
      expect(await database.getWahooImport(neighbour.id)).toMatchObject({
        statusId: undefined,
        hadStatus: false
      })
    })
  })

  describe('markWahooImportFailed', () => {
    it('fails that import unless it already completed', async () => {
      const actor = await newActor()
      const neighbour = await database.upsertWahooImport({
        actorId: actor,
        providerUserId: 'p',
        workoutId: 'neighbour'
      })
      const completed = await database.upsertWahooImport({
        actorId: actor,
        providerUserId: 'p',
        workoutId: 'completed'
      })
      await database.updateWahooImport(completed.id, { status: 'completed' })
      const target = await database.upsertWahooImport({
        actorId: actor,
        providerUserId: 'p',
        workoutId: 'target'
      })
      const neighbourBefore = await rawImport(neighbour.id)
      const completedBefore = await rawImport(completed.id)
      at(4000)

      await database.markWahooImportFailed(target.id, 'unsupported', 'no gps')
      await database.markWahooImportFailed(completed.id, 'failed', 'late')

      expect(await rawImport(target.id)).toMatchObject({
        status: 'unsupported',
        lastError: 'no gps',
        updatedAt: T0 + 4000
      })
      expect(await rawImport(completed.id)).toEqual(completedBefore)
      expect(await rawImport(neighbour.id)).toEqual(neighbourBefore)
    })
  })

  describe('markWahooImportPending', () => {
    it('requeues only that failed or unsupported import', async () => {
      const actor = await newActor()
      const upsertCompleted = async () => {
        const created = await database.upsertWahooImport({
          actorId: actor,
          providerUserId: 'p',
          workoutId: 'completed'
        })
        await database.updateWahooImport(created.id, { status: 'completed' })
        return created.id
      }
      const make = async (workoutId: string, status: 'failed' | 'running') => {
        const created = await database.upsertWahooImport({
          actorId: actor,
          providerUserId: 'p',
          workoutId
        })
        await database.updateWahooImport(created.id, {
          status,
          lastError: `${workoutId}-error`
        })
        return created.id
      }
      const neighbour = await make('neighbour', 'failed')
      const running = await make('running', 'running')
      const target = await make('target', 'failed')
      const completed = await upsertCompleted()
      const neighbourBefore = await rawImport(neighbour)
      const runningBefore = await rawImport(running)
      const completedBefore = await rawImport(completed)
      at(6000)

      await expect(database.markWahooImportPending(target)).resolves.toBe(true)
      await expect(database.markWahooImportPending(running)).resolves.toBe(
        false
      )
      await expect(database.markWahooImportPending('missing')).resolves.toBe(
        false
      )
      await expect(database.markWahooImportPending(completed)).resolves.toBe(
        false
      )

      expect(await rawImport(target)).toMatchObject({
        status: 'pending',
        lastError: null,
        updatedAt: T0 + 6000
      })
      expect(await rawImport(running)).toEqual(runningBefore)
      expect(await rawImport(completed)).toEqual(completedBefore)
      expect(await rawImport(neighbour)).toEqual(neighbourBefore)
    })

    it('requeues an unsupported import', async () => {
      const actor = await newActor()
      const created = await database.upsertWahooImport({
        actorId: actor,
        providerUserId: 'p',
        workoutId: 'u'
      })
      await database.markWahooImportFailed(created.id, 'unsupported', 'nope')

      await expect(database.markWahooImportPending(created.id)).resolves.toBe(
        true
      )
    })
  })

  describe('history imports', () => {
    const makeHistory = (actorId: string, fromDate = '2026-01-01') =>
      database.createWahooHistoryImport({
        actorId,
        providerUserId: 'p',
        fromDate,
        toDate: '2026-12-31'
      })

    it('creates a pending history and stores its dates as dates', async () => {
      const actor = await newActor()

      const created = await makeHistory(actor, '2026-02-03')

      expect(created).toEqual({
        id: created.id,
        actorId: actor,
        providerUserId: 'p',
        fromDate: '2026-02-03',
        toDate: '2026-12-31',
        nextPage: 1,
        scanComplete: false,
        total: 0,
        completed: 0,
        failed: 0,
        status: 'pending'
      })
      expect(await database.getWahooHistoryImport(created.id)).toEqual({
        ...created,
        lastError: undefined
      })
      expect(await rawHistory(created.id)).toMatchObject({
        createdAt: T0,
        updatedAt: T0
      })
    })

    it('returns the history with that id and the actor’s newest one', async () => {
      const actor = await newActor()
      const otherActor = await newActor()
      at(0)
      const oldest = await makeHistory(actor, '2026-01-01')
      at(1000)
      const newest = await makeHistory(actor, '2026-02-01')
      at(2000)
      const otherNewer = await makeHistory(otherActor, '2026-03-01')
      at(500)
      const middle = await makeHistory(actor, '2026-04-01')

      expect(await database.getLatestWahooHistoryImport(actor)).toMatchObject({
        id: newest.id,
        fromDate: '2026-02-01'
      })
      expect(
        await database.getLatestWahooHistoryImport(otherActor)
      ).toMatchObject({ id: otherNewer.id })
      expect(await database.getLatestWahooHistoryImport('nobody')).toBeNull()
      expect(await database.getWahooHistoryImport(oldest.id)).toMatchObject({
        id: oldest.id
      })
      expect(await database.getWahooHistoryImport(middle.id)).toMatchObject({
        id: middle.id,
        fromDate: '2026-04-01'
      })
      expect(await database.getWahooHistoryImport('missing')).toBeNull()
    })

    it('updates only that history and only while it is in an expected status', async () => {
      const actor = await newActor()
      const neighbour = await makeHistory(actor)
      const target = await makeHistory(actor)
      const neighbourBefore = await rawHistory(neighbour.id)
      at(8000)

      await expect(
        database.updateWahooHistoryImport(target.id, {
          nextPage: 5,
          scanComplete: true,
          total: 9,
          completed: 4,
          failed: 2,
          status: 'running',
          lastError: 'slow'
        })
      ).resolves.toBe(true)
      expect(await rawHistory(target.id)).toMatchObject({
        nextPage: 5,
        scanComplete: true,
        total: 9,
        completed: 4,
        failed: 2,
        status: 'running',
        lastError: 'slow',
        updatedAt: T0 + 8000
      })
      expect(await rawHistory(neighbour.id)).toEqual(neighbourBefore)

      const beforeMismatch = await rawHistory(target.id)
      at(9000)
      await expect(
        database.updateWahooHistoryImport(target.id, { status: 'failed' }, [
          'pending',
          'failed'
        ])
      ).resolves.toBe(false)
      await expect(
        database.updateWahooHistoryImport(target.id, { status: 'failed' }, [])
      ).resolves.toBe(false)
      expect(await rawHistory(target.id)).toEqual(beforeMismatch)

      await expect(
        database.updateWahooHistoryImport(
          target.id,
          { status: 'completed', lastError: null },
          ['running']
        )
      ).resolves.toBe(true)
      expect(await rawHistory(target.id)).toMatchObject({
        status: 'completed',
        lastError: null
      })
      await expect(
        database.updateWahooHistoryImport('missing', { status: 'failed' })
      ).resolves.toBe(false)
      expect(await rawHistory(neighbour.id)).toEqual(neighbourBefore)
    })

    it('leaves fields that were not passed alone', async () => {
      const actor = await newActor()
      const target = await makeHistory(actor)
      await database.updateWahooHistoryImport(target.id, {
        nextPage: 3,
        scanComplete: true,
        total: 7
      })

      await database.updateWahooHistoryImport(target.id, { completed: 2 })

      expect(await database.getWahooHistoryImport(target.id)).toMatchObject({
        nextPage: 3,
        scanComplete: true,
        total: 7,
        completed: 2,
        status: 'pending'
      })
    })

    it('cancels the actor’s unfinished histories only', async () => {
      const actor = await newActor()
      const otherActor = await newActor()
      const make = async (owner: string, status: string) => {
        const created = await makeHistory(owner)
        await db
          .updateTable('wahoo_history_imports')
          .set({ status })
          .where('id', '=', created.id)
          .execute()
        return created.id
      }
      const otherPending = await make(otherActor, 'pending')
      const pending = await make(actor, 'pending')
      const running = await make(actor, 'running')
      const failed = await make(actor, 'failed')
      const completed = await make(actor, 'completed')
      const cancelled = await make(actor, 'cancelled')
      const otherBefore = await rawHistory(otherPending)
      const completedBefore = await rawHistory(completed)
      const cancelledBefore = await rawHistory(cancelled)
      at(2500)

      await database.cancelWahooHistoryImportsByActor(actor)

      for (const id of [pending, running, failed]) {
        expect(await rawHistory(id)).toMatchObject({
          status: 'cancelled',
          updatedAt: T0 + 2500
        })
      }
      expect(await rawHistory(completed)).toEqual(completedBefore)
      expect(await rawHistory(cancelled)).toEqual(cancelledBefore)
      expect(await rawHistory(otherPending)).toEqual(otherBefore)
    })

    it('lists and counts the imports of that history only', async () => {
      const actor = await newActor()
      const history = await makeHistory(actor)
      const otherHistory = await makeHistory(actor)
      const add = async (
        workoutId: string,
        historyImportId: string | undefined,
        status: 'pending' | 'running' | 'completed' | 'failed' | 'unsupported'
      ) => {
        const created = await database.upsertWahooImport({
          actorId: actor,
          providerUserId: 'p',
          workoutId,
          historyImportId
        })
        await database.updateWahooImport(created.id, { status })
        return created.id
      }
      await add('other-failed', otherHistory.id, 'failed')
      await add('none-completed', undefined, 'completed')
      const pending = await add('pending', history.id, 'pending')
      const running = await add('running', history.id, 'running')
      const completed = await add('completed', history.id, 'completed')
      const failed = await add('failed', history.id, 'failed')
      const unsupported = await add('unsupported', history.id, 'unsupported')

      const byId = (items: { id: string }[]) =>
        items.map((item) => item.id).sort()
      expect(byId(await database.getWahooImportsByHistory(history.id))).toEqual(
        [pending, running, completed, failed, unsupported].sort()
      )
      expect(
        byId(
          await database.getWahooImportsByHistory(history.id, [
            'failed',
            'unsupported'
          ])
        )
      ).toEqual([failed, unsupported].sort())
      expect(await database.getWahooImportsByHistory(history.id, [])).toEqual(
        []
      )
      expect(await database.getWahooImportsByHistory('missing')).toEqual([])
      expect(await database.countWahooHistoryItems(history.id)).toEqual({
        total: 5,
        completed: 1,
        failed: 2,
        pending: 2
      })
      expect(await database.countWahooHistoryItems(otherHistory.id)).toEqual({
        total: 1,
        completed: 0,
        failed: 1,
        pending: 0
      })
      expect(await database.countWahooHistoryItems('missing')).toEqual({
        total: 0,
        completed: 0,
        failed: 0,
        pending: 0
      })
    })
  })
})
