import { createActivity } from '@/lib/database/sql/fitnessGearTestHelpers'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'

describe('FitnessGearDatabase', () => {
  const { actors } = DatabaseSeed
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

    describe('device gear', () => {
      // Devices link through their own column, so the shared `createActivity`
      // helper (which assigns `gearId`) cannot seed them.
      const createDeviceActivity = async (
        db: Database,
        {
          actorId,
          pathSuffix,
          distanceMeters,
          activityStartTime,
          deviceGearId,
          statusId,
          processingStatus = 'completed',
          isPrimary = true
        }: {
          actorId: string
          pathSuffix: string
          distanceMeters: number
          activityStartTime?: Date
          deviceGearId?: string
          statusId?: string
          processingStatus?: 'pending' | 'processing' | 'completed' | 'failed'
          isPrimary?: boolean
        }
      ) => {
        const file = await db.createFitnessFile({
          actorId,
          ...(statusId ? { statusId } : {}),
          path: `fitness/device-${pathSuffix}.fit`,
          fileName: `device-${pathSuffix}.fit`,
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024
        })
        await db.updateFitnessFileActivityData(file!.id, {
          activityType: 'cycling',
          activityStartTime: activityStartTime ?? null,
          totalDistanceMeters: distanceMeters,
          ...(deviceGearId ? { deviceGearId } : {})
        })
        await db.updateFitnessFileProcessingStatus(file!.id, processingStatus)
        if (!isPrimary) {
          await db.updateFitnessFilePrimary(file!.id, false)
        }
        return file!
      }

      it('round-trips deviceKey and productUrl', async () => {
        const created = await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'device',
          name: 'Garmin Edge 840',
          brand: 'Garmin',
          model: 'Edge 840',
          deviceKey: 'name:garmin edge 840',
          productUrl: 'https://www.garmin.com'
        })

        expect(created.kind).toBe('device')
        expect(created.deviceKey).toBe('name:garmin edge 840')
        expect(created.productUrl).toBe('https://www.garmin.com')

        const found = await database.findFitnessGearByDeviceKey({
          actorId: actors.primary.id,
          deviceKey: 'name:garmin edge 840'
        })
        expect(found?.id).toBe(created.id)
      })

      it('does not resolve another actor’s device key', async () => {
        await database.createFitnessGear({
          actorId: actors.extra.id,
          kind: 'device',
          name: 'Wahoo ELEMNT BOLT',
          deviceKey: 'name:wahoo elemnt bolt'
        })

        expect(
          await database.findFitnessGearByDeviceKey({
            actorId: actors.replyAuthor.id,
            deviceKey: 'name:wahoo elemnt bolt'
          })
        ).toBeNull()
      })

      it('rejects a duplicate device key for the same actor', async () => {
        await database.createFitnessGear({
          actorId: actors.pollAuthor.id,
          kind: 'device',
          name: 'Coros',
          deviceKey: 'mfr:coros'
        })

        await expect(
          database.createFitnessGear({
            actorId: actors.pollAuthor.id,
            kind: 'device',
            name: 'Coros again',
            deviceKey: 'mfr:coros'
          })
        ).rejects.toThrow()
      })

      it('leaves bikes and shoes unconstrained by the unique index', async () => {
        // NULLs compare as distinct on both backends, so a shed full of
        // key-less gear is fine.
        await database.createFitnessGear({
          actorId: actors.pollAuthor.id,
          kind: 'bike',
          name: 'No key one'
        })
        await expect(
          database.createFitnessGear({
            actorId: actors.pollAuthor.id,
            kind: 'shoes',
            name: 'No key two'
          })
        ).resolves.toMatchObject({ name: 'No key two' })
      })

      it('never rewrites the device key on update', async () => {
        const device = await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'device',
          name: 'Suunto',
          deviceKey: 'mfr:suunto',
          productUrl: 'https://www.suunto.com'
        })

        const updated = await database.updateFitnessGear({
          id: device.id,
          actorId: actors.primary.id,
          name: 'the watch',
          productUrl: 'https://www.suunto.com/en-us/products/watches/'
        })

        expect(updated?.name).toBe('the watch')
        expect(updated?.productUrl).toBe(
          'https://www.suunto.com/en-us/products/watches/'
        )
        // The identity every later upload matches against is untouched.
        expect(updated?.deviceKey).toBe('mfr:suunto')
      })

      it('clears the product page on an explicit null and leaves it alone otherwise', async () => {
        const device = await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'device',
          name: 'Polar',
          deviceKey: 'mfr:polar',
          productUrl: 'https://www.polar.com'
        })

        const renamed = await database.updateFitnessGear({
          id: device.id,
          actorId: actors.primary.id,
          name: 'Polar watch'
        })
        expect(renamed?.productUrl).toBe('https://www.polar.com')

        const cleared = await database.updateFitnessGear({
          id: device.id,
          actorId: actors.primary.id,
          productUrl: null
        })
        expect(cleared?.productUrl).toBeUndefined()
      })

      it('releases the device key and detaches activities on delete', async () => {
        const device = await database.createFitnessGear({
          actorId: actors.extra.id,
          kind: 'device',
          name: 'Bryton',
          deviceKey: 'mfr:bryton'
        })
        const activity = await createDeviceActivity(database, {
          actorId: actors.extra.id,
          pathSuffix: 'delete-detach',
          distanceMeters: 21_000,
          activityStartTime: new Date('2026-04-01T08:00:00.000Z'),
          deviceGearId: device.id
        })

        expect(
          await database.deleteFitnessGear({
            id: device.id,
            actorId: actors.extra.id
          })
        ).toBe(true)

        const detached = await database.getFitnessFile({ id: activity.id })
        expect(detached?.deviceGearId).toBeUndefined()
        expect(detached?.totalDistanceMeters).toBe(21_000)

        // The key has to be released, not just hidden: the unique index covers
        // soft-deleted rows, so the next upload from this device could never
        // create a row otherwise.
        expect(
          await database.findFitnessGearByDeviceKey({
            actorId: actors.extra.id,
            deviceKey: 'mfr:bryton'
          })
        ).toBeNull()
        await expect(
          database.createFitnessGear({
            actorId: actors.extra.id,
            kind: 'device',
            name: 'Bryton again',
            deviceKey: 'mfr:bryton'
          })
        ).resolves.toMatchObject({ deviceKey: 'mfr:bryton' })
      })

      describe('getFitnessGearDeviceRollups', () => {
        it('counts activities, reports the earliest start, and zero-fills', async () => {
          const device = await database.createFitnessGear({
            actorId: actors.replyAuthor.id,
            kind: 'device',
            name: 'Rollup device',
            deviceKey: 'name:rollup device'
          })
          const empty = await database.createFitnessGear({
            actorId: actors.replyAuthor.id,
            kind: 'device',
            name: 'Never used',
            deviceKey: 'name:never used'
          })

          await createDeviceActivity(database, {
            actorId: actors.replyAuthor.id,
            pathSuffix: 'rollup-1',
            distanceMeters: 30_000,
            activityStartTime: new Date('2026-02-01T08:00:00.000Z'),
            deviceGearId: device.id
          })
          await createDeviceActivity(database, {
            actorId: actors.replyAuthor.id,
            pathSuffix: 'rollup-2',
            distanceMeters: 10_000,
            activityStartTime: new Date('2026-01-01T08:00:00.000Z'),
            deviceGearId: device.id
          })

          const rollups = await database.getFitnessGearDeviceRollups({
            actorId: actors.replyAuthor.id,
            gearIds: [device.id, empty.id]
          })

          expect(rollups[device.id]).toEqual({
            activityCount: 2,
            firstUsedAt: new Date('2026-01-01T08:00:00.000Z').getTime()
          })
          expect(rollups[empty.id]).toEqual({
            activityCount: 0,
            firstUsedAt: null
          })
        })

        it('excludes deleted and unfinished activities, but counts secondary files', async () => {
          const device = await database.createFitnessGear({
            actorId: actors.replyAuthor.id,
            kind: 'device',
            name: 'Filtered device',
            deviceKey: 'name:filtered device'
          })

          await createDeviceActivity(database, {
            actorId: actors.replyAuthor.id,
            pathSuffix: 'filter-counted',
            distanceMeters: 5_000,
            activityStartTime: new Date('2026-05-01T08:00:00.000Z'),
            deviceGearId: device.id
          })
          await createDeviceActivity(database, {
            actorId: actors.replyAuthor.id,
            pathSuffix: 'filter-processing',
            distanceMeters: 5_000,
            activityStartTime: new Date('2026-05-02T08:00:00.000Z'),
            deviceGearId: device.id,
            processingStatus: 'processing'
          })
          await createDeviceActivity(database, {
            actorId: actors.replyAuthor.id,
            pathSuffix: 'filter-secondary',
            distanceMeters: 5_000,
            activityStartTime: new Date('2026-05-03T08:00:00.000Z'),
            deviceGearId: device.id,
            isPrimary: false
          })
          const deleted = await createDeviceActivity(database, {
            actorId: actors.replyAuthor.id,
            pathSuffix: 'filter-deleted',
            distanceMeters: 5_000,
            activityStartTime: new Date('2026-05-04T08:00:00.000Z'),
            deviceGearId: device.id
          })
          await database.deleteFitnessFile({ id: deleted.id })

          const rollups = await database.getFitnessGearDeviceRollups({
            actorId: actors.replyAuthor.id,
            gearIds: [device.id]
          })
          // The completed primary AND the completed secondary — `isPrimary` is
          // the one clause of the shared predicate that does not transfer to a
          // device, since the secondary file IS the second device's record.
          // The deleted and still-processing ones stay out.
          expect(rollups[device.id].activityCount).toBe(2)
        })

        it('returns an empty map for no gear', async () => {
          expect(
            await database.getFitnessGearDeviceRollups({
              actorId: actors.primary.id,
              gearIds: []
            })
          ).toEqual({})
        })
      })

      describe('getFitnessGearActivities', () => {
        it('matches on deviceGearId for a device and gearId for a bike', async () => {
          const device = await database.createFitnessGear({
            actorId: actors.extra.id,
            kind: 'device',
            name: 'List device',
            deviceKey: 'name:list device'
          })
          const bike = await database.createFitnessGear({
            actorId: actors.extra.id,
            kind: 'bike',
            name: 'List bike'
          })

          const onDevice = await createDeviceActivity(database, {
            actorId: actors.extra.id,
            pathSuffix: 'list-device',
            distanceMeters: 42_600,
            activityStartTime: new Date('2026-06-01T08:00:00.000Z'),
            deviceGearId: device.id
          })
          const onBike = await createActivity(database, {
            actorId: actors.extra.id,
            pathSuffix: 'list-bike',
            distanceMeters: 12_000,
            activityStartTime: new Date('2026-06-02T08:00:00.000Z'),
            gearId: bike.id
          })

          const deviceRows = await database.getFitnessGearActivities({
            actorId: actors.extra.id,
            gearId: device.id,
            kind: 'device',
            limit: 10
          })
          expect(deviceRows.map((row) => row.id)).toEqual([onDevice.id])
          // An activity that was never posted still occupies a row: the caller
          // pages on rows, so dropping it would make the offsets skip it.
          expect(deviceRows[0]).toMatchObject({ statusId: null })

          const bikeRows = await database.getFitnessGearActivities({
            actorId: actors.extra.id,
            gearId: bike.id,
            kind: 'bike',
            limit: 10
          })
          expect(bikeRows.map((row) => row.id)).toEqual([onBike.id])
        })

        it('carries the id of the post the activity was published as', async () => {
          // `statusId` is the whole reason this reader exists — the route hands
          // it to `getStatusesByIds` and renders the posts. A wrong column or a
          // wrong alias would empty every gear's Activities feed silently, with
          // the whole suite still green.
          const device = await database.createFitnessGear({
            actorId: actors.extra.id,
            kind: 'device',
            name: 'Posted device',
            deviceKey: 'name:posted device'
          })
          const statusId = `${actors.extra.id}/statuses/device-activity-link`
          await database.createNote({
            id: statusId,
            url: statusId,
            actorId: actors.extra.id,
            to: [],
            cc: [],
            text: 'Recorded on the device'
          })
          const file = await database.createFitnessFile({
            actorId: actors.extra.id,
            statusId,
            path: 'fitness/device-posted.fit',
            fileName: 'device-posted.fit',
            fileType: 'fit',
            mimeType: 'application/vnd.ant.fit',
            bytes: 1024
          })
          await database.updateFitnessFileActivityData(file!.id, {
            activityType: 'cycling',
            activityStartTime: new Date('2026-06-03T08:00:00.000Z'),
            totalDistanceMeters: 5_000,
            deviceGearId: device.id
          })
          await database.updateFitnessFileProcessingStatus(
            file!.id,
            'completed'
          )

          const rows = await database.getFitnessGearActivities({
            actorId: actors.extra.id,
            gearId: device.id,
            kind: 'device',
            limit: 10
          })
          expect(rows).toHaveLength(1)
          expect(rows[0].statusId).toBe(statusId)
        })

        it('counts one ride once when both files came off the same device', async () => {
          // A `.fit` and a `.gpx` of the same ride, or a manual upload beside
          // the Strava sync: the merge marks one non-primary, but BOTH carry
          // the same device. Counting both would report one ride twice and
          // list it twice.
          const device = await database.createFitnessGear({
            actorId: actors.extra.id,
            kind: 'device',
            name: 'One device two files',
            deviceKey: 'name:one device two files'
          })
          const statusId = `${actors.extra.id}/statuses/same-device-merge`
          await database.createNote({
            id: statusId,
            url: statusId,
            actorId: actors.extra.id,
            to: [],
            cc: [],
            text: 'One ride, two files'
          })

          const primary = await createDeviceActivity(database, {
            actorId: actors.extra.id,
            pathSuffix: 'same-device-primary',
            distanceMeters: 42_600,
            activityStartTime: new Date('2026-06-06T08:00:00.000Z'),
            deviceGearId: device.id,
            statusId
          })
          await createDeviceActivity(database, {
            actorId: actors.extra.id,
            pathSuffix: 'same-device-secondary',
            distanceMeters: 42_600,
            activityStartTime: new Date('2026-06-06T08:00:00.000Z'),
            deviceGearId: device.id,
            statusId,
            isPrimary: false
          })

          const rollups = await database.getFitnessGearDeviceRollups({
            actorId: actors.extra.id,
            gearIds: [device.id]
          })
          expect(rollups[device.id].activityCount).toBe(1)

          const rows = await database.getFitnessGearActivities({
            actorId: actors.extra.id,
            gearId: device.id,
            kind: 'device',
            limit: 10
          })
          // The count and the page must never disagree.
          expect(rows.map((row) => row.id)).toEqual([primary.id])
        })

        it('counts one ride once when a device left several files and lost the merge', async () => {
          // Three files in one overlap group: a head unit's (which wins the
          // merge) and TWO from the watch. The watch owns no primary, so a
          // "does a primary of mine exist" test suppresses neither of its
          // files and reports one ride twice.
          const headUnit = await database.createFitnessGear({
            actorId: actors.replyAuthor.id,
            kind: 'device',
            name: 'Group head unit',
            deviceKey: 'name:group head unit'
          })
          const watch = await database.createFitnessGear({
            actorId: actors.replyAuthor.id,
            kind: 'device',
            name: 'Group watch',
            deviceKey: 'name:group watch'
          })
          const statusId = `${actors.replyAuthor.id}/statuses/three-file-merge`
          await database.createNote({
            id: statusId,
            url: statusId,
            actorId: actors.replyAuthor.id,
            to: [],
            cc: [],
            text: 'One ride, three files'
          })

          await createDeviceActivity(database, {
            actorId: actors.replyAuthor.id,
            pathSuffix: 'group-head',
            distanceMeters: 42_600,
            activityStartTime: new Date('2026-10-01T08:00:00.000Z'),
            deviceGearId: headUnit.id,
            statusId
          })
          for (const suffix of ['group-watch-fit', 'group-watch-gpx']) {
            await createDeviceActivity(database, {
              actorId: actors.replyAuthor.id,
              pathSuffix: suffix,
              distanceMeters: 42_600,
              activityStartTime: new Date('2026-10-01T08:00:00.000Z'),
              deviceGearId: watch.id,
              statusId,
              isPrimary: false
            })
          }

          const rollups = await database.getFitnessGearDeviceRollups({
            actorId: actors.replyAuthor.id,
            gearIds: [headUnit.id, watch.id]
          })
          expect(rollups[headUnit.id].activityCount).toBe(1)
          expect(rollups[watch.id].activityCount).toBe(1)

          const rows = await database.getFitnessGearActivities({
            actorId: actors.replyAuthor.id,
            gearId: watch.id,
            kind: 'device',
            limit: 10
          })
          expect(rows).toHaveLength(1)
        })

        it('keeps a ride whose primary is still processing or failed', async () => {
          // A merge writes the primary `pending` and the secondaries
          // `completed`, so deferring to a primary that does not itself count
          // would drop the ride from the device until processing finished — and
          // permanently if it ended `failed`.
          const device = await database.createFitnessGear({
            actorId: actors.replyAuthor.id,
            kind: 'device',
            name: 'Unfinished primary device',
            deviceKey: 'name:unfinished primary device'
          })
          const statusId = `${actors.replyAuthor.id}/statuses/pending-primary`
          await database.createNote({
            id: statusId,
            url: statusId,
            actorId: actors.replyAuthor.id,
            to: [],
            cc: [],
            text: 'Primary still processing'
          })

          await createDeviceActivity(database, {
            actorId: actors.replyAuthor.id,
            pathSuffix: 'pending-primary',
            distanceMeters: 42_600,
            activityStartTime: new Date('2026-10-02T08:00:00.000Z'),
            deviceGearId: device.id,
            statusId,
            processingStatus: 'pending'
          })
          const secondary = await createDeviceActivity(database, {
            actorId: actors.replyAuthor.id,
            pathSuffix: 'completed-secondary',
            distanceMeters: 42_600,
            activityStartTime: new Date('2026-10-02T08:00:00.000Z'),
            deviceGearId: device.id,
            statusId,
            isPrimary: false
          })

          const rollups = await database.getFitnessGearDeviceRollups({
            actorId: actors.replyAuthor.id,
            gearIds: [device.id]
          })
          expect(rollups[device.id].activityCount).toBe(1)

          const rows = await database.getFitnessGearActivities({
            actorId: actors.replyAuthor.id,
            gearId: device.id,
            kind: 'device',
            limit: 10
          })
          expect(rows.map((row) => row.id)).toEqual([secondary.id])
        })

        it('counts the secondary file of a merged same-ride post', async () => {
          // `isPrimary` keeps one ride from being counted twice toward the BIKE
          // it was ridden on. For a device it is the opposite: the two files
          // are what distinguishes the two devices, and the non-primary one is
          // the only trace the second device left. Without this, the watch that
          // recorded the secondary half gets a row reporting 0 activities
          // forever — the import links every file before the group is merged.
          const headUnit = await database.createFitnessGear({
            actorId: actors.extra.id,
            kind: 'device',
            name: 'Merged head unit',
            deviceKey: 'name:merged head unit'
          })
          const watch = await database.createFitnessGear({
            actorId: actors.extra.id,
            kind: 'device',
            name: 'Second device',
            deviceKey: 'name:second device'
          })
          const statusId = `${actors.extra.id}/statuses/two-device-merge`
          await database.createNote({
            id: statusId,
            url: statusId,
            actorId: actors.extra.id,
            to: [],
            cc: [],
            text: 'One ride, two devices'
          })

          // The head unit's file wins the merge; the watch's is marked
          // non-primary and is the ONLY trace the watch left.
          await createDeviceActivity(database, {
            actorId: actors.extra.id,
            pathSuffix: 'merged-primary',
            distanceMeters: 42_600,
            activityStartTime: new Date('2026-06-04T08:00:00.000Z'),
            deviceGearId: headUnit.id,
            statusId
          })
          const secondary = await createDeviceActivity(database, {
            actorId: actors.extra.id,
            pathSuffix: 'merged-secondary',
            distanceMeters: 42_600,
            activityStartTime: new Date('2026-06-04T08:00:00.000Z'),
            deviceGearId: watch.id,
            statusId,
            isPrimary: false
          })

          const rollups = await database.getFitnessGearDeviceRollups({
            actorId: actors.extra.id,
            gearIds: [watch.id]
          })
          expect(rollups[watch.id].activityCount).toBe(1)

          const rows = await database.getFitnessGearActivities({
            actorId: actors.extra.id,
            gearId: watch.id,
            kind: 'device',
            limit: 10
          })
          expect(rows.map((row) => row.id)).toEqual([secondary.id])

          // The bike rollup still excludes it, so a merged ride is not counted
          // twice toward the bike.
          const bike = await database.createFitnessGear({
            actorId: actors.extra.id,
            kind: 'bike',
            name: 'Merged ride bike'
          })
          await database.assignFitnessFileGearIfUnset({
            fitnessFileId: secondary.id,
            actorId: actors.extra.id,
            gearId: bike.id
          })
          const bikeRollups = await database.getFitnessGearDistanceRollups({
            actorId: actors.extra.id,
            gearIds: [bike.id]
          })
          expect(bikeRollups[bike.id].activityCount).toBe(0)
        })

        it('orders newest first and sorts timestamp-less activities last on both backends', async () => {
          const device = await database.createFitnessGear({
            actorId: actors.pollAuthor.id,
            kind: 'device',
            name: 'Order device',
            deviceKey: 'name:order device'
          })

          const older = await createDeviceActivity(database, {
            actorId: actors.pollAuthor.id,
            pathSuffix: 'order-older',
            distanceMeters: 1_000,
            activityStartTime: new Date('2026-07-01T08:00:00.000Z'),
            deviceGearId: device.id
          })
          const newer = await createDeviceActivity(database, {
            actorId: actors.pollAuthor.id,
            pathSuffix: 'order-newer',
            distanceMeters: 2_000,
            activityStartTime: new Date('2026-07-02T08:00:00.000Z'),
            deviceGearId: device.id
          })
          // PostgreSQL puts NULLs first under DESC and SQLite puts them last,
          // so the NULL half of this assertion only bites on PostgreSQL — run
          // the suite with TEST_DATABASE_TYPE=pg to exercise it (CI pins
          // sqlite). What makes it hold on both is the portable CASE in
          // `getFitnessGearActivities`, NOT knex's `nulls: 'last'` option,
          // which is broken on SQLite: knex emulates it as
          // `order by (col is null) desc`, dropping the column's own direction.
          // Do not "simplify" the implementation back to that option.
          const undated = await createDeviceActivity(database, {
            actorId: actors.pollAuthor.id,
            pathSuffix: 'order-undated',
            distanceMeters: 3_000,
            deviceGearId: device.id
          })

          const rows = await database.getFitnessGearActivities({
            actorId: actors.pollAuthor.id,
            gearId: device.id,
            kind: 'device',
            limit: 10
          })
          expect(rows.map((row) => row.id)).toEqual([
            newer.id,
            older.id,
            undated.id
          ])
        })

        it('paginates without repeating or skipping a row', async () => {
          const device = await database.createFitnessGear({
            actorId: actors.pollAuthor.id,
            kind: 'device',
            name: 'Page device',
            deviceKey: 'name:page device'
          })
          // Every activity shares one start time, so `activityStartTime` and
          // `createdAt` cannot order them: only the `id` tiebreak makes the
          // ordering total. Drop it and a row repeats or vanishes between
          // pages, which is exactly what this asserts.
          for (let index = 0; index < 5; index += 1) {
            await createDeviceActivity(database, {
              actorId: actors.pollAuthor.id,
              pathSuffix: `page-${index}`,
              distanceMeters: 1_000 * (index + 1),
              activityStartTime: new Date(Date.UTC(2026, 7, 1, 8, 0, 0)),
              deviceGearId: device.id
            })
          }

          const first = await database.getFitnessGearActivities({
            actorId: actors.pollAuthor.id,
            gearId: device.id,
            kind: 'device',
            limit: 2
          })
          const second = await database.getFitnessGearActivities({
            actorId: actors.pollAuthor.id,
            gearId: device.id,
            kind: 'device',
            limit: 2,
            offset: 2
          })

          expect(first).toHaveLength(2)
          expect(second).toHaveLength(2)
          expect(new Set([...first, ...second].map((row) => row.id)).size).toBe(
            4
          )
        })

        it('excludes activities the rollups do not count', async () => {
          const device = await database.createFitnessGear({
            actorId: actors.primary.id,
            kind: 'device',
            name: 'Countable device',
            deviceKey: 'name:countable device'
          })
          await createDeviceActivity(database, {
            actorId: actors.primary.id,
            pathSuffix: 'countable-pending',
            distanceMeters: 1_000,
            activityStartTime: new Date('2026-09-01T08:00:00.000Z'),
            deviceGearId: device.id,
            processingStatus: 'pending'
          })

          expect(
            await database.getFitnessGearActivities({
              actorId: actors.primary.id,
              gearId: device.id,
              kind: 'device',
              limit: 10
            })
          ).toEqual([])
        })
      })
    })
  })
})
