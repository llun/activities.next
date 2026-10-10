import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

const T0 = Date.parse('2026-04-01T00:00:00.000Z')

// Each test uses its own actors and ids and keeps neighbouring imports (another
// actor's, another batch's) that the query under test must leave alone.
describe('strava archive import queries', () => {
  const testDb = createTestDatabase()
  const { database, db } = testDb

  let counter = 0
  const create = (
    overrides: Partial<Parameters<typeof database.createStravaArchiveImport>[0]>
  ) => {
    counter += 1
    return database.createStravaArchiveImport({
      actorId: `https://saq.test/users/default-${counter}`,
      archiveId: `archive-${counter}`,
      archiveFitnessFileId: `file-${counter}`,
      batchId: `batch-${counter}`,
      visibility: 'private',
      ...overrides
    })
  }

  const actor = () => {
    counter += 1
    return `https://saq.test/users/a${counter}`
  }

  const rawRow = (id: string) =>
    db
      .selectFrom('strava_archive_imports')
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

  describe('createStravaArchiveImport', () => {
    it('stores the returned import and nothing else for other actors', async () => {
      const owner = actor()
      const created = await create({
        id: 'saq-create',
        actorId: owner,
        archiveId: 'saq-create-archive',
        archiveFitnessFileId: 'saq-create-file',
        batchId: 'saq-create-batch',
        visibility: 'direct'
      })

      expect(created).toEqual({
        id: 'saq-create',
        actorId: owner,
        archiveId: 'saq-create-archive',
        archiveFitnessFileId: 'saq-create-file',
        batchId: 'saq-create-batch',
        visibility: 'direct',
        status: 'importing',
        nextActivityIndex: 0,
        pendingMediaActivities: [],
        mediaAttachmentRetry: 0,
        totalActivitiesCount: undefined,
        completedActivitiesCount: 0,
        failedActivitiesCount: 0,
        firstFailureMessage: undefined,
        lastError: undefined,
        resolvedAt: undefined,
        createdAt: T0,
        updatedAt: T0
      })
      expect(await rawRow('saq-create')).toMatchObject({
        createdAt: T0,
        updatedAt: T0,
        resolvedAt: null,
        pendingMediaActivities: null
      })
    })

    it('names the violated unique rule so the upload route can report a conflict', async () => {
      const owner = actor()
      await create({ actorId: owner, archiveId: 'saq-dup-archive' })
      const conflict = /unique constraint|duplicate key value/i

      // A second unresolved import for the actor.
      await expect(create({ actorId: owner })).rejects.toThrow(conflict)
      // The same archive for another actor.
      await expect(
        create({ actorId: actor(), archiveId: 'saq-dup-archive' })
      ).rejects.toThrow(conflict)
    })
  })

  describe('lookups', () => {
    it('finds an import by its own id', async () => {
      const first = await create({})
      const second = await create({})

      expect(
        await database.getStravaArchiveImportById({ id: second.id })
      ).toEqual(second)
      expect(
        await database.getStravaArchiveImportById({ id: first.id })
      ).toEqual(first)
    })

    it('finds the newest import of a batch, ignoring other batches and actors', async () => {
      const owner = actor()
      const otherOwner = actor()
      at(0)
      const older = await create({ actorId: owner, batchId: 'saq-batch' })
      await database.updateStravaArchiveImport({
        id: older.id,
        resolvedAt: T0
      })
      at(1000)
      const newer = await create({ actorId: owner, batchId: 'saq-batch' })
      await database.updateStravaArchiveImport({
        id: newer.id,
        resolvedAt: T0 + 1000
      })
      // Newer than both: another batch of the same actor, and the same batch id
      // for another actor.
      at(2000)
      await create({ actorId: owner, batchId: 'saq-other-batch' })
      at(3000)
      const otherActorBatch = await create({
        actorId: otherOwner,
        batchId: 'saq-batch'
      })

      expect(
        await database.getStravaArchiveImportByBatchId({
          batchId: 'saq-batch'
        })
      ).toMatchObject({ id: otherActorBatch.id })
      expect(
        await database.getStravaArchiveImportByBatchId({
          batchId: 'saq-other-batch'
        })
      ).toMatchObject({ actorId: owner, batchId: 'saq-other-batch' })
      expect(
        await database.getStravaArchiveImportByBatchId({
          batchId: 'saq-missing'
        })
      ).toBeNull()
      // Within the batch the newest wins.
      await database.deleteStravaArchiveImport({ id: otherActorBatch.id })
      expect(
        await database.getStravaArchiveImportByBatchId({
          batchId: 'saq-batch'
        })
      ).toMatchObject({ id: newer.id })
    })

    it('finds the unresolved import of that actor only', async () => {
      const owner = actor()
      const otherOwner = actor()
      at(0)
      const older = await create({ actorId: owner })
      await database.updateStravaArchiveImport({
        id: older.id,
        resolvedAt: T0 + 1
      })
      // A newer, resolved import of the same actor, then the older one is
      // reopened (an actor holds one unresolved import at a time).
      at(1000)
      const newer = await create({ actorId: owner })
      await database.updateStravaArchiveImport({
        id: newer.id,
        resolvedAt: T0 + 1001
      })
      await database.updateStravaArchiveImport({
        id: older.id,
        resolvedAt: null
      })
      // The newest import of all belongs to another actor.
      at(2000)
      const otherActive = await create({ actorId: otherOwner })

      expect(
        await database.getActiveStravaArchiveImportByActor({ actorId: owner })
      ).toMatchObject({ id: older.id })
      expect(
        await database.getActiveStravaArchiveImportByActor({
          actorId: otherOwner
        })
      ).toMatchObject({ id: otherActive.id })

      await database.updateStravaArchiveImport({
        id: older.id,
        resolvedAt: T0 + 2500
      })
      expect(
        await database.getActiveStravaArchiveImportByActor({ actorId: owner })
      ).toBeNull()
      expect(
        await database.getActiveStravaArchiveImportByActor({
          actorId: 'https://saq.test/users/nobody'
        })
      ).toBeNull()
    })
  })

  describe('updateStravaArchiveImport', () => {
    it('changes only that import', async () => {
      const owner = actor()
      const neighbour = await create({ actorId: owner })
      await database.updateStravaArchiveImport({
        id: neighbour.id,
        resolvedAt: T0
      })
      const otherNeighbour = await create({})
      const target = await create({ actorId: owner })
      const neighbourBefore = await rawRow(neighbour.id)
      const otherNeighbourBefore = await rawRow(otherNeighbour.id)
      at(5000)

      const updated = await database.updateStravaArchiveImport({
        id: target.id,
        status: 'failed',
        nextActivityIndex: 4,
        totalActivitiesCount: 9,
        completedActivitiesCount: 3,
        failedActivitiesCount: 1,
        firstFailureMessage: 'first',
        lastError: 'last',
        mediaAttachmentRetry: 2,
        archiveFitnessFileId: 'new-file',
        resolvedAt: T0 + 4000
      })

      expect(updated).toEqual({
        ...target,
        status: 'failed',
        nextActivityIndex: 4,
        totalActivitiesCount: 9,
        completedActivitiesCount: 3,
        failedActivitiesCount: 1,
        firstFailureMessage: 'first',
        lastError: 'last',
        mediaAttachmentRetry: 2,
        archiveFitnessFileId: 'new-file',
        resolvedAt: T0 + 4000,
        updatedAt: T0 + 5000
      })
      expect(await rawRow(neighbour.id)).toEqual(neighbourBefore)
      expect(await rawRow(otherNeighbour.id)).toEqual(otherNeighbourBefore)
    })

    it('does not report a change for an unknown id', async () => {
      const neighbour = await create({})
      const before = await rawRow(neighbour.id)

      await expect(
        database.updateStravaArchiveImport({
          id: 'saq-missing',
          status: 'cancelled',
          lastError: 'x'
        })
      ).resolves.toBeNull()

      expect(await rawRow(neighbour.id)).toEqual(before)
    })

    it('writes pending media activities as plain JSON text', async () => {
      const neighbour = await create({})
      const target = await create({})
      const pending = [
        {
          fitnessFileId: 'fit-ü',
          activityId: '1',
          activityName: 'Läuft "schön" \\ 日本語',
          mediaPaths: ['media/a b.jpg', 'media/ü.jpg']
        }
      ]

      const updated = await database.updateStravaArchiveImport({
        id: target.id,
        pendingMediaActivities: pending
      })

      expect(updated?.pendingMediaActivities).toEqual(pending)
      expect((await rawRow(target.id)).pendingMediaActivities).toBe(
        JSON.stringify(pending)
      )
      expect((await rawRow(neighbour.id)).pendingMediaActivities).toBeNull()
      expect(
        (await database.getStravaArchiveImportById({ id: neighbour.id }))
          ?.pendingMediaActivities
      ).toEqual([])
    })
  })

  describe('deleteStravaArchiveImport', () => {
    it('removes only that import', async () => {
      const owner = actor()
      const neighbour = await create({ actorId: owner })
      await database.updateStravaArchiveImport({
        id: neighbour.id,
        resolvedAt: T0
      })
      const other = await create({})
      const target = await create({ actorId: owner })

      await expect(
        database.deleteStravaArchiveImport({ id: target.id })
      ).resolves.toBe(true)

      expect(
        await database.getStravaArchiveImportById({ id: target.id })
      ).toBeNull()
      expect(
        await database.getStravaArchiveImportById({ id: neighbour.id })
      ).toMatchObject({ id: neighbour.id })
      expect(
        await database.getStravaArchiveImportById({ id: other.id })
      ).toMatchObject({ id: other.id })
    })
  })
})
