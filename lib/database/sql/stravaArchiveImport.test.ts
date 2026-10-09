import {
  databaseBeforeAll,
  getTestDatabaseTable,
  getTestDatabaseWithInstance
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'

const ACTOR_A = 'https://llun.test/users/strava-archive-a'
const ACTOR_B = 'https://llun.test/users/strava-archive-b'

describe('StravaArchiveImportDatabase', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  describe.each(table)('%s', (_, database) => {
    let counter = 0
    const create = (
      overrides: Partial<
        Parameters<Database['createStravaArchiveImport']>[0]
      > = {}
    ) => {
      counter += 1
      return database.createStravaArchiveImport({
        actorId: ACTOR_A,
        archiveId: `archive-${counter}`,
        archiveFitnessFileId: `file-${counter}`,
        batchId: `batch-${counter}`,
        visibility: 'private',
        ...overrides
      })
    }

    afterAll(async () => {
      await database.destroy()
    })

    describe('createStravaArchiveImport', () => {
      it('starts an import in the importing state with zeroed progress counters', async () => {
        const created = await create({
          id: 'import-defaults',
          visibility: 'unlisted'
        })

        expect(created).toMatchObject({
          id: 'import-defaults',
          actorId: ACTOR_A,
          visibility: 'unlisted',
          status: 'importing',
          nextActivityIndex: 0,
          pendingMediaActivities: [],
          mediaAttachmentRetry: 0,
          completedActivitiesCount: 0,
          failedActivitiesCount: 0
        })
        expect(created.totalActivitiesCount).toBeUndefined()
        expect(created.firstFailureMessage).toBeUndefined()
        expect(created.lastError).toBeUndefined()
        expect(created.resolvedAt).toBeUndefined()

        await database.deleteStravaArchiveImport({ id: 'import-defaults' })
      })

      it('persists the row so it can be read back by id', async () => {
        const created = await create({ actorId: ACTOR_B })

        const fetched = await database.getStravaArchiveImportById({
          id: created.id
        })

        expect(fetched).toEqual(created)

        await database.deleteStravaArchiveImport({ id: created.id })
      })

      it('rejects a second unresolved import for the same actor', async () => {
        const first = await create({ actorId: ACTOR_A })

        await expect(create({ actorId: ACTOR_A })).rejects.toThrow()

        await database.deleteStravaArchiveImport({ id: first.id })
      })

      it('allows a new import once the actor’s previous one is resolved', async () => {
        const first = await create({ actorId: ACTOR_A })
        await database.updateStravaArchiveImport({
          id: first.id,
          status: 'completed',
          resolvedAt: Date.now()
        })

        const second = await create({ actorId: ACTOR_A })

        expect(second.id).not.toBe(first.id)

        await database.deleteStravaArchiveImport({ id: first.id })
        await database.deleteStravaArchiveImport({ id: second.id })
      })

      it('rejects reusing an archive id across imports', async () => {
        const first = await create({
          actorId: ACTOR_A,
          archiveId: 'archive-shared'
        })

        await expect(
          create({ actorId: ACTOR_B, archiveId: 'archive-shared' })
        ).rejects.toThrow()

        await database.deleteStravaArchiveImport({ id: first.id })
      })
    })

    describe('getStravaArchiveImportById', () => {
      it('returns null for an unknown id', async () => {
        await expect(
          database.getStravaArchiveImportById({ id: 'missing' })
        ).resolves.toBeNull()
      })
    })

    describe('getStravaArchiveImportByBatchId', () => {
      it('returns the import for the batch', async () => {
        const created = await create({ batchId: 'batch-lookup' })

        const fetched = await database.getStravaArchiveImportByBatchId({
          batchId: 'batch-lookup'
        })

        expect(fetched?.id).toBe(created.id)

        await database.deleteStravaArchiveImport({ id: created.id })
      })

      it('returns the most recently created import when a batch id is reused', async () => {
        vi.useFakeTimers()
        try {
          vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'))
          const older = await create({
            actorId: ACTOR_A,
            batchId: 'batch-reused'
          })
          await database.updateStravaArchiveImport({
            id: older.id,
            resolvedAt: Date.now()
          })

          vi.setSystemTime(new Date('2025-01-02T00:00:00.000Z'))
          const newer = await create({
            actorId: ACTOR_A,
            batchId: 'batch-reused'
          })

          const fetched = await database.getStravaArchiveImportByBatchId({
            batchId: 'batch-reused'
          })

          expect(fetched?.id).toBe(newer.id)

          await database.deleteStravaArchiveImport({ id: older.id })
          await database.deleteStravaArchiveImport({ id: newer.id })
        } finally {
          vi.useRealTimers()
        }
      })

      it('returns null when no import has that batch', async () => {
        await expect(
          database.getStravaArchiveImportByBatchId({ batchId: 'no-batch' })
        ).resolves.toBeNull()
      })
    })

    describe('getActiveStravaArchiveImportByActor', () => {
      it('returns the unresolved import for the actor', async () => {
        const created = await create({ actorId: ACTOR_B })

        const active = await database.getActiveStravaArchiveImportByActor({
          actorId: ACTOR_B
        })

        expect(active?.id).toBe(created.id)

        await database.deleteStravaArchiveImport({ id: created.id })
      })

      it('does not return another actor’s import', async () => {
        const created = await create({ actorId: ACTOR_A })

        await expect(
          database.getActiveStravaArchiveImportByActor({ actorId: ACTOR_B })
        ).resolves.toBeNull()

        await database.deleteStravaArchiveImport({ id: created.id })
      })

      it('ignores imports that have been resolved', async () => {
        const created = await create({ actorId: ACTOR_A })
        await database.updateStravaArchiveImport({
          id: created.id,
          status: 'failed',
          resolvedAt: Date.now()
        })

        await expect(
          database.getActiveStravaArchiveImportByActor({ actorId: ACTOR_A })
        ).resolves.toBeNull()

        await database.deleteStravaArchiveImport({ id: created.id })
      })
    })

    describe('updateStravaArchiveImport', () => {
      it('updates every provided field and returns the stored row', async () => {
        const created = await create()
        const resolvedAt = new Date('2025-03-04T05:06:07.000Z').getTime()

        const updated = await database.updateStravaArchiveImport({
          id: created.id,
          archiveFitnessFileId: 'file-replaced',
          status: 'failed',
          nextActivityIndex: 7,
          mediaAttachmentRetry: 2,
          totalActivitiesCount: 10,
          completedActivitiesCount: 6,
          failedActivitiesCount: 1,
          firstFailureMessage: 'bad gpx',
          lastError: 'timeout',
          resolvedAt
        })

        expect(updated).toMatchObject({
          id: created.id,
          archiveFitnessFileId: 'file-replaced',
          status: 'failed',
          nextActivityIndex: 7,
          mediaAttachmentRetry: 2,
          totalActivitiesCount: 10,
          completedActivitiesCount: 6,
          failedActivitiesCount: 1,
          firstFailureMessage: 'bad gpx',
          lastError: 'timeout',
          resolvedAt
        })
        expect(updated?.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)
        expect(
          await database.getStravaArchiveImportById({ id: created.id })
        ).toEqual(updated)

        await database.deleteStravaArchiveImport({ id: created.id })
      })

      it('leaves fields that were not passed untouched', async () => {
        const created = await create()
        await database.updateStravaArchiveImport({
          id: created.id,
          nextActivityIndex: 3,
          lastError: 'first error'
        })

        const updated = await database.updateStravaArchiveImport({
          id: created.id,
          completedActivitiesCount: 4
        })

        expect(updated).toMatchObject({
          nextActivityIndex: 3,
          lastError: 'first error',
          completedActivitiesCount: 4,
          status: 'importing'
        })

        await database.deleteStravaArchiveImport({ id: created.id })
      })

      it('clears nullable fields when null is passed', async () => {
        const created = await create()
        await database.updateStravaArchiveImport({
          id: created.id,
          totalActivitiesCount: 5,
          firstFailureMessage: 'oops',
          lastError: 'oops again',
          resolvedAt: Date.now()
        })

        const cleared = await database.updateStravaArchiveImport({
          id: created.id,
          totalActivitiesCount: null,
          firstFailureMessage: null,
          lastError: null,
          resolvedAt: null
        })

        expect(cleared?.totalActivitiesCount).toBeUndefined()
        expect(cleared?.firstFailureMessage).toBeUndefined()
        expect(cleared?.lastError).toBeUndefined()
        expect(cleared?.resolvedAt).toBeUndefined()

        await database.deleteStravaArchiveImport({ id: created.id })
      })

      it('reopens a resolved import for the actor when resolvedAt is cleared', async () => {
        const created = await create({ actorId: ACTOR_B })
        await database.updateStravaArchiveImport({
          id: created.id,
          resolvedAt: Date.now()
        })
        expect(
          await database.getActiveStravaArchiveImportByActor({
            actorId: ACTOR_B
          })
        ).toBeNull()

        await database.updateStravaArchiveImport({
          id: created.id,
          resolvedAt: null
        })

        expect(
          (
            await database.getActiveStravaArchiveImportByActor({
              actorId: ACTOR_B
            })
          )?.id
        ).toBe(created.id)

        await database.deleteStravaArchiveImport({ id: created.id })
      })

      it('stores pending media activities and reads them back', async () => {
        const created = await create()
        const pending = [
          {
            fitnessFileId: 'fit-1',
            activityId: '111',
            activityName: 'Morning Ride',
            mediaPaths: ['media/a.jpg', 'media/b.jpg']
          },
          { fitnessFileId: 'fit-2', activityId: '222', mediaPaths: ['c.jpg'] }
        ]

        const updated = await database.updateStravaArchiveImport({
          id: created.id,
          pendingMediaActivities: pending
        })

        expect(updated?.pendingMediaActivities).toEqual(pending)

        const emptied = await database.updateStravaArchiveImport({
          id: created.id,
          pendingMediaActivities: []
        })
        expect(emptied?.pendingMediaActivities).toEqual([])

        await database.deleteStravaArchiveImport({ id: created.id })
      })

      it('returns null when the import does not exist', async () => {
        await expect(
          database.updateStravaArchiveImport({
            id: 'missing',
            status: 'cancelled'
          })
        ).resolves.toBeNull()
      })
    })

    describe('deleteStravaArchiveImport', () => {
      it('deletes the import and reports true', async () => {
        const created = await create()

        await expect(
          database.deleteStravaArchiveImport({ id: created.id })
        ).resolves.toBe(true)
        await expect(
          database.getStravaArchiveImportById({ id: created.id })
        ).resolves.toBeNull()
      })

      it('reports false when nothing was deleted', async () => {
        await expect(
          database.deleteStravaArchiveImport({ id: 'missing' })
        ).resolves.toBe(false)
      })
    })
  })
})

describe('StravaArchiveImportDatabase pending media sanitising', () => {
  const { database, instance, prepare } = getTestDatabaseWithInstance(true)

  beforeAll(async () => {
    await prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  const readPendingFor = async (rawValue: string | null) => {
    const id = crypto.randomUUID()
    await database.createStravaArchiveImport({
      id,
      actorId: `https://llun.test/users/${id}`,
      archiveId: `archive-${id}`,
      archiveFitnessFileId: 'file',
      batchId: `batch-${id}`,
      visibility: 'private'
    })
    await instance('strava_archive_imports')
      .where({ id })
      .update({ pendingMediaActivities: rawValue })
    return (await database.getStravaArchiveImportById({ id }))
      ?.pendingMediaActivities
  }

  it.each([
    ['null column', null],
    ['malformed JSON', '{not json'],
    ['a JSON object rather than an array', '{"fitnessFileId":"a"}']
  ])('treats %s as no pending activities', async (_, raw) => {
    await expect(readPendingFor(raw)).resolves.toEqual([])
  })

  it('trims values, drops entries missing required fields and blank media paths', async () => {
    const raw = JSON.stringify([
      {
        fitnessFileId: ' fit-1 ',
        activityId: ' 1 ',
        activityName: '  Lunch Run  ',
        mediaPaths: [' a.jpg ', '', '   ', null]
      },
      {
        fitnessFileId: 'fit-2',
        activityId: '2',
        activityName: '   ',
        mediaPaths: ['b.jpg']
      },
      { fitnessFileId: '', activityId: '3', mediaPaths: ['c.jpg'] },
      { fitnessFileId: 'fit-4', activityId: '', mediaPaths: ['d.jpg'] },
      { fitnessFileId: 'fit-5', activityId: '5', mediaPaths: ['  '] },
      { fitnessFileId: 'fit-6', activityId: '6', mediaPaths: 'not-an-array' },
      'a string',
      null
    ])

    await expect(readPendingFor(raw)).resolves.toEqual([
      {
        fitnessFileId: 'fit-1',
        activityId: '1',
        activityName: 'Lunch Run',
        mediaPaths: ['a.jpg']
      },
      { fitnessFileId: 'fit-2', activityId: '2', mediaPaths: ['b.jpg'] }
    ])
  })
})
