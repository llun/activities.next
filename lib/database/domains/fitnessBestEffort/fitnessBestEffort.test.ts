import type { FitnessBestEffortValue } from '@/lib/database/domains/fitnessBestEffort/types'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import type { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'

const DAY_MS = 24 * 60 * 60 * 1000

describe('FitnessBestEffortDatabase', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  describe.each(table)('%s', (_, database) => {
    beforeAll(async () => {
      await seedDatabase(database)
    })

    afterAll(async () => {
      await database.destroy()
    })

    let sequence = 0

    const createActor = async (db: Database) => {
      sequence += 1
      const username = `efforts-${sequence}`
      const actorId = `https://llun.test/users/${username}`
      await db.createActor({
        actorId,
        username,
        domain: 'llun.test',
        inboxUrl: `${actorId}/inbox`,
        followersUrl: `${actorId}/followers`,
        sharedInboxUrl: 'https://llun.test/inbox',
        publicKey: `public-key-${username}`,
        privateKey: `private-key-${username}`,
        createdAt: Date.now()
      })
      return actorId
    }

    // A posted, processed, primary activity holding `efforts`.
    const createActivity = async ({
      actorId,
      activityDate,
      efforts,
      primary = true
    }: {
      actorId: string
      activityDate: number
      efforts: FitnessBestEffortValue[]
      primary?: boolean
    }) => {
      sequence += 1
      const statusId = `${actorId}/statuses/effort-${sequence}`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId,
        to: [],
        cc: [],
        text: `Effort ${sequence}`
      })
      const file = await database.createFitnessFile({
        actorId,
        statusId,
        path: `fitness/effort-${sequence}.fit`,
        fileName: `effort-${sequence}.fit`,
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 256
      })
      const fitnessFileId = file!.id
      await database.updateFitnessFileProcessingStatus(
        fitnessFileId,
        'completed'
      )
      if (!primary)
        await database.updateFitnessFilePrimary(fitnessFileId, false)
      await database.replaceFitnessBestEfforts({
        fitnessFileId,
        actorId,
        statusId,
        activityType: 'ride',
        activityDate,
        efforts
      })
      return { fitnessFileId, statusId }
    }

    const power = (key: number, value: number): FitnessBestEffortValue => ({
      kind: 'power',
      key,
      value
    })
    const distance = (key: number, value: number): FitnessBestEffortValue => ({
      kind: 'distance',
      key,
      value
    })

    it('rewrites a file’s efforts when it is reprocessed', async () => {
      const actorId = await createActor(database)
      const { fitnessFileId, statusId } = await createActivity({
        actorId,
        activityDate: Date.now(),
        efforts: [power(5, 900), power(60, 500)]
      })

      await database.replaceFitnessBestEfforts({
        fitnessFileId,
        actorId,
        statusId,
        activityType: 'ride',
        activityDate: Date.now(),
        efforts: [power(5, 950)]
      })

      expect(
        await database.getFitnessBestEfforts({
          fitnessFileIds: [fitnessFileId]
        })
      ).toEqual([{ fitnessFileId, kind: 'power', key: 5, value: 950 }])
    })

    it('refuses to store efforts for a deleted file', async () => {
      const actorId = await createActor(database)
      const { fitnessFileId, statusId } = await createActivity({
        actorId,
        activityDate: Date.now(),
        efforts: []
      })
      await database.deleteFitnessFile({ id: fitnessFileId })

      await expect(
        database.replaceFitnessBestEfforts({
          fitnessFileId,
          actorId,
          statusId,
          activityType: 'ride',
          activityDate: Date.now(),
          efforts: [power(5, 900)]
        })
      ).rejects.toThrow('missing or deleted fitness file')
    })

    it('drops the efforts with a deleted file and a deleted post', async () => {
      const actorId = await createActor(database)
      const deletedFile = await createActivity({
        actorId,
        activityDate: Date.now(),
        efforts: [power(5, 900)]
      })
      const deletedPost = await createActivity({
        actorId,
        activityDate: Date.now(),
        efforts: [power(5, 800)]
      })

      await database.deleteFitnessFile({ id: deletedFile.fitnessFileId })
      await database.deleteStatus({ actorId, statusId: deletedPost.statusId })

      expect(
        await database.getFitnessBestEfforts({
          fitnessFileIds: [deletedFile.fitnessFileId, deletedPost.fitnessFileId]
        })
      ).toEqual([])
      expect(await database.getFitnessPersonalRecords({ actorId })).toEqual([])
    })

    it('reads the best per key: highest power, shortest time, earliest tie', async () => {
      const actorId = await createActor(database)
      const now = Date.now()
      const older = await createActivity({
        actorId,
        activityDate: now - 200 * DAY_MS,
        efforts: [power(5, 1000), distance(5000, 1500)]
      })
      const tie = await createActivity({
        actorId,
        activityDate: now - 100 * DAY_MS,
        efforts: [power(5, 1000), power(60, 400)]
      })
      const recent = await createActivity({
        actorId,
        activityDate: now - 10 * DAY_MS,
        efforts: [power(5, 700), power(60, 450), distance(5000, 1600)]
      })
      // A secondary recording of a ride does not count, as in every rollup.
      await createActivity({
        actorId,
        activityDate: now - 5 * DAY_MS,
        efforts: [power(5, 2000)],
        primary: false
      })

      const all = await database.getFitnessPersonalRecords({ actorId })
      expect(
        all.map(({ kind, key, value, fitnessFileId }) => ({
          kind,
          key,
          value,
          fitnessFileId
        }))
      ).toEqual([
        {
          kind: 'power',
          key: 5,
          value: 1000,
          fitnessFileId: older.fitnessFileId
        },
        {
          kind: 'power',
          key: 60,
          value: 450,
          fitnessFileId: recent.fitnessFileId
        },
        {
          kind: 'distance',
          key: 5000,
          value: 1500,
          fitnessFileId: older.fitnessFileId
        }
      ])
      expect(all[0]).toMatchObject({
        statusId: older.statusId,
        activityDate: now - 200 * DAY_MS,
        activityType: 'ride'
      })

      const lastQuarter = await database.getFitnessPersonalRecords({
        actorId,
        since: now - 150 * DAY_MS
      })
      expect(
        lastQuarter.map(({ kind, key, value, fitnessFileId }) => ({
          kind,
          key,
          value,
          fitnessFileId
        }))
      ).toEqual([
        {
          kind: 'power',
          key: 5,
          value: 1000,
          fitnessFileId: tie.fitnessFileId
        },
        {
          kind: 'power',
          key: 60,
          value: 450,
          fitnessFileId: recent.fitnessFileId
        },
        {
          kind: 'distance',
          key: 5000,
          value: 1600,
          fitnessFileId: recent.fitnessFileId
        }
      ])

      expect(
        await database.getFitnessPersonalRecords({
          actorId,
          since: now - DAY_MS
        })
      ).toEqual([])
    })

    it('never reads another actor’s efforts', async () => {
      const owner = await createActor(database)
      const other = await createActor(database)
      await createActivity({
        actorId: other,
        activityDate: Date.now(),
        efforts: [power(5, 1500)]
      })

      expect(
        await database.getFitnessPersonalRecords({ actorId: owner })
      ).toEqual([])
    })

    it('stores and reads fractional distance keys', async () => {
      const actorId = await createActor(database)
      const { fitnessFileId } = await createActivity({
        actorId,
        activityDate: Date.now(),
        efforts: [distance(21097.5, 5400.5)]
      })

      expect(
        await database.getFitnessBestEfforts({
          fitnessFileIds: [fitnessFileId]
        })
      ).toEqual([
        { fitnessFileId, kind: 'distance', key: 21097.5, value: 5400.5 }
      ])
      expect(await database.getFitnessPersonalRecords({ actorId })).toEqual([
        expect.objectContaining({ key: 21097.5, value: 5400.5 })
      ])
    })
  })
})
