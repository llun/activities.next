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

    // Creates a completed, primary activity attributed to `gearId` — the only
    // shape the rollups count.
    const createActivity = async (
      db: Database,
      {
        actorId,
        pathSuffix,
        distanceMeters,
        activityStartTime,
        gearId,
        processingStatus = 'completed',
        isPrimary = true
      }: {
        actorId: string
        pathSuffix: string
        distanceMeters: number
        activityStartTime?: Date
        gearId?: string
        processingStatus?: 'pending' | 'processing' | 'completed' | 'failed'
        isPrimary?: boolean
      }
    ) => {
      const file = await db.createFitnessFile({
        actorId,
        path: `fitness/gear-${pathSuffix}.fit`,
        fileName: `gear-${pathSuffix}.fit`,
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1024
      })
      await db.updateFitnessFileActivityData(file!.id, {
        activityType: 'cycling',
        activityStartTime: activityStartTime ?? null,
        totalDistanceMeters: distanceMeters
      })
      await db.updateFitnessFileProcessingStatus(file!.id, processingStatus)
      if (!isPrimary) {
        await db.updateFitnessFilePrimary(file!.id, false)
      }
      if (gearId) {
        await db.assignFitnessFileGearIfUnset({
          fitnessFileId: file!.id,
          actorId,
          gearId
        })
      }
      return file!
    }

    describe('createFitnessGear and getFitnessGear', () => {
      it('round-trips every field including the default sports list', async () => {
        const created = await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'bike',
          name: 'Moots',
          brand: 'Moots',
          model: 'Vamoots RSL disc',
          bikeType: 'Road bike',
          weightKilograms: 8.1,
          defaultSports: ['ride', 'gravel_ride'],
          notes: 'Titanium'
        })

        expect(created).toMatchObject({
          actorId: actors.primary.id,
          kind: 'bike',
          name: 'Moots',
          brand: 'Moots',
          model: 'Vamoots RSL disc',
          bikeType: 'Road bike',
          weightKilograms: 8.1,
          defaultSports: ['ride', 'gravel_ride'],
          notes: 'Titanium'
        })
        expect(created.retiredAt).toBeUndefined()

        const fetched = await database.getFitnessGear({
          id: created.id,
          actorId: actors.primary.id
        })
        expect(fetched).toMatchObject({
          id: created.id,
          name: 'Moots',
          defaultSports: ['ride', 'gravel_ride']
        })
      })

      it('defaults the sports list to empty when none is given', async () => {
        const created = await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'shoes',
          name: 'Plain shoes'
        })
        expect(created.defaultSports).toEqual([])
      })

      it('hides gear from another actor', async () => {
        const created = await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'bike',
          name: 'Not yours'
        })

        const fetched = await database.getFitnessGear({
          id: created.id,
          actorId: actors.replyAuthor.id
        })
        expect(fetched).toBeNull()
      })
    })

    describe('default sport exclusivity', () => {
      it('takes a sport away from the gear that held it on create', async () => {
        const first = await database.createFitnessGear({
          actorId: actors.pollAuthor.id,
          kind: 'bike',
          name: 'Steal source',
          defaultSports: ['ride', 'virtual_ride']
        })
        const second = await database.createFitnessGear({
          actorId: actors.pollAuthor.id,
          kind: 'bike',
          name: 'Steal target',
          defaultSports: ['ride']
        })

        const reloadedFirst = await database.getFitnessGear({
          id: first.id,
          actorId: actors.pollAuthor.id
        })
        expect(reloadedFirst?.defaultSports).toEqual(['virtual_ride'])
        expect(second.defaultSports).toEqual(['ride'])
      })

      it('takes a sport away on update without disturbing the gear being updated', async () => {
        const holder = await database.createFitnessGear({
          actorId: actors.followRequester.id,
          kind: 'shoes',
          name: 'Update holder',
          defaultSports: ['run', 'walk']
        })
        const claimer = await database.createFitnessGear({
          actorId: actors.followRequester.id,
          kind: 'shoes',
          name: 'Update claimer',
          defaultSports: ['hike']
        })

        const updated = await database.updateFitnessGear({
          id: claimer.id,
          actorId: actors.followRequester.id,
          defaultSports: ['hike', 'run']
        })
        expect(updated?.defaultSports).toEqual(['hike', 'run'])

        const reloadedHolder = await database.getFitnessGear({
          id: holder.id,
          actorId: actors.followRequester.id
        })
        expect(reloadedHolder?.defaultSports).toEqual(['walk'])
      })

      it('takes a sport away from retired gear too, so unretiring cannot create a second holder', async () => {
        const retired = await database.createFitnessGear({
          actorId: actors.extra.id,
          kind: 'bike',
          name: 'Retired holder',
          defaultSports: ['mountain_bike_ride']
        })
        await database.setFitnessGearRetired({
          id: retired.id,
          actorId: actors.extra.id,
          retired: true
        })

        await database.createFitnessGear({
          actorId: actors.extra.id,
          kind: 'bike',
          name: 'Active claimer',
          defaultSports: ['mountain_bike_ride']
        })

        const reloadedRetired = await database.getFitnessGear({
          id: retired.id,
          actorId: actors.extra.id
        })
        expect(reloadedRetired?.defaultSports).toEqual([])
      })

      it('leaves another actor’s defaults alone', async () => {
        const otherActorGear = await database.createFitnessGear({
          actorId: actors.replyAuthor.id,
          kind: 'bike',
          name: 'Other actor bike',
          defaultSports: ['ebike_ride']
        })
        await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'bike',
          name: 'Same sport, different actor',
          defaultSports: ['ebike_ride']
        })

        const reloaded = await database.getFitnessGear({
          id: otherActorGear.id,
          actorId: actors.replyAuthor.id
        })
        expect(reloaded?.defaultSports).toEqual(['ebike_ride'])
      })
    })

    describe('updateFitnessGear', () => {
      it('leaves absent fields untouched and clears explicit nulls', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'bike',
          name: 'Presence semantics',
          brand: 'Brompton',
          model: 'S6L',
          weightKilograms: 11.7
        })

        const updated = await database.updateFitnessGear({
          id: gear.id,
          actorId: actors.primary.id,
          model: null
        })

        expect(updated).toMatchObject({
          name: 'Presence semantics',
          brand: 'Brompton',
          weightKilograms: 11.7
        })
        expect(updated?.model).toBeUndefined()
      })

      it('returns null for another actor’s gear', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'bike',
          name: 'Foreign update'
        })

        const updated = await database.updateFitnessGear({
          id: gear.id,
          actorId: actors.replyAuthor.id,
          name: 'Hijacked'
        })
        expect(updated).toBeNull()

        const reloaded = await database.getFitnessGear({
          id: gear.id,
          actorId: actors.primary.id
        })
        expect(reloaded?.name).toBe('Foreign update')
      })

      it('re-arms the distance alert when the threshold changes', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'shoes',
          name: 'Alert re-arm',
          alertDistanceMeters: 650_000
        })
        await database.setFitnessGearLastAlertedDistance({
          id: gear.id,
          lastAlertedDistanceMeters: 651_000
        })

        const updated = await database.updateFitnessGear({
          id: gear.id,
          actorId: actors.primary.id,
          alertDistanceMeters: 800_000
        })
        expect(updated?.lastAlertedDistanceMeters).toBeUndefined()
      })

      it('keeps the alert state when the threshold is rewritten unchanged', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'shoes',
          name: 'Alert unchanged',
          alertDistanceMeters: 650_000
        })
        await database.setFitnessGearLastAlertedDistance({
          id: gear.id,
          lastAlertedDistanceMeters: 651_000
        })

        const updated = await database.updateFitnessGear({
          id: gear.id,
          actorId: actors.primary.id,
          alertDistanceMeters: 650_000,
          name: 'Alert unchanged renamed'
        })
        expect(updated?.lastAlertedDistanceMeters).toBe(651_000)
      })
    })

    describe('setFitnessGearRetired', () => {
      it('retires and unretires', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'bike',
          name: 'Retire toggle'
        })

        const retired = await database.setFitnessGearRetired({
          id: gear.id,
          actorId: actors.primary.id,
          retired: true
        })
        expect(retired?.retiredAt).toEqual(expect.any(Number))

        const unretired = await database.setFitnessGearRetired({
          id: gear.id,
          actorId: actors.primary.id,
          retired: false
        })
        expect(unretired?.retiredAt).toBeUndefined()
      })

      it('changes nothing when the gear is already in the requested state', async () => {
        // A double click or an idempotent client retry must not move the date
        // the owner put the gear away on, nor re-arm a reminder that has fired.
        //
        // The clock is faked and advanced deliberately: the two calls otherwise
        // land in the same millisecond, so the `retiredAt` assertion would pass
        // against an unconditional write and guard nothing.
        vi.useFakeTimers({ toFake: ['Date'] })
        try {
          vi.setSystemTime(new Date('2026-03-01T10:00:00.000Z'))
          const gear = await database.createFitnessGear({
            actorId: actors.primary.id,
            kind: 'shoes',
            name: 'Retire no-op',
            alertDistanceMeters: 650_000
          })
          const retired = await database.setFitnessGearRetired({
            id: gear.id,
            actorId: actors.primary.id,
            retired: true
          })
          await database.setFitnessGearLastAlertedDistance({
            id: gear.id,
            lastAlertedDistanceMeters: 651_000
          })

          vi.setSystemTime(new Date('2026-03-02T10:00:00.000Z'))
          const again = await database.setFitnessGearRetired({
            id: gear.id,
            actorId: actors.primary.id,
            retired: true
          })

          expect(again?.retiredAt).toBe(retired?.retiredAt)
          expect(again?.lastAlertedDistanceMeters).toBe(651_000)
        } finally {
          vi.useRealTimers()
        }
      })

      it('still reports the gear when the toggle is a no-op, and null when it is not the actor’s', async () => {
        // A no-op writes no row, so the result cannot be keyed on the affected
        // count — "already retired" and "no such gear" must stay distinguishable.
        const gear = await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'bike',
          name: 'Retire no-op result'
        })

        expect(
          await database.setFitnessGearRetired({
            id: gear.id,
            actorId: actors.primary.id,
            retired: false
          })
        ).toMatchObject({ id: gear.id })
        expect(
          await database.setFitnessGearRetired({
            id: gear.id,
            actorId: actors.replyAuthor.id,
            retired: false
          })
        ).toBeNull()
      })

      it('returns null for another actor’s gear', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'bike',
          name: 'Foreign retire'
        })
        const result = await database.setFitnessGearRetired({
          id: gear.id,
          actorId: actors.replyAuthor.id,
          retired: true
        })
        expect(result).toBeNull()
      })
    })

    describe('deleteFitnessGear', () => {
      it('soft-deletes the gear and detaches its activities in one go', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.extra.id,
          kind: 'bike',
          name: 'Delete me'
        })
        const activity = await createActivity(database, {
          actorId: actors.extra.id,
          pathSuffix: 'delete-detach',
          distanceMeters: 12_000,
          activityStartTime: new Date('2026-03-01T08:00:00.000Z'),
          gearId: gear.id
        })

        expect(
          await database.deleteFitnessGear({
            id: gear.id,
            actorId: actors.extra.id
          })
        ).toBe(true)

        expect(
          await database.getFitnessGear({
            id: gear.id,
            actorId: actors.extra.id
          })
        ).toBeNull()

        const detached = await database.getFitnessFile({ id: activity.id })
        expect(detached?.gearId).toBeUndefined()
        // The activity keeps its own distance — only the attribution is gone.
        expect(detached?.totalDistanceMeters).toBe(12_000)
      })

      it('returns false on a second delete and for another actor', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.extra.id,
          kind: 'bike',
          name: 'Delete twice'
        })

        expect(
          await database.deleteFitnessGear({
            id: gear.id,
            actorId: actors.replyAuthor.id
          })
        ).toBe(false)
        expect(
          await database.deleteFitnessGear({
            id: gear.id,
            actorId: actors.extra.id
          })
        ).toBe(true)
        expect(
          await database.deleteFitnessGear({
            id: gear.id,
            actorId: actors.extra.id
          })
        ).toBe(false)
      })
    })

    describe('getFitnessGearDistanceRollups', () => {
      it('sums attributed activities and zero-fills gear with none', async () => {
        const bike = await database.createFitnessGear({
          actorId: actors.pollAuthor.id,
          kind: 'bike',
          name: 'Rollup bike'
        })
        const emptyGear = await database.createFitnessGear({
          actorId: actors.pollAuthor.id,
          kind: 'bike',
          name: 'Rollup empty'
        })

        await createActivity(database, {
          actorId: actors.pollAuthor.id,
          pathSuffix: 'rollup-1',
          distanceMeters: 42_600,
          activityStartTime: new Date('2026-04-01T08:00:00.000Z'),
          gearId: bike.id
        })
        await createActivity(database, {
          actorId: actors.pollAuthor.id,
          pathSuffix: 'rollup-2',
          distanceMeters: 63_800,
          activityStartTime: new Date('2026-04-05T08:00:00.000Z'),
          gearId: bike.id
        })

        const rollups = await database.getFitnessGearDistanceRollups({
          actorId: actors.pollAuthor.id,
          gearIds: [bike.id, emptyGear.id]
        })

        expect(rollups[bike.id]).toEqual({
          distanceMeters: 106_400,
          activityCount: 2
        })
        expect(rollups[emptyGear.id]).toEqual({
          distanceMeters: 0,
          activityCount: 0
        })
      })

      it('counts an activity with no recorded start time', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.followRequester.id,
          kind: 'bike',
          name: 'Rollup no start time'
        })
        await createActivity(database, {
          actorId: actors.followRequester.id,
          pathSuffix: 'rollup-no-start',
          distanceMeters: 5_000,
          gearId: gear.id
        })

        const rollups = await database.getFitnessGearDistanceRollups({
          actorId: actors.followRequester.id,
          gearIds: [gear.id]
        })
        expect(rollups[gear.id]).toEqual({
          distanceMeters: 5_000,
          activityCount: 1
        })
      })

      it.each([
        {
          description: 'still processing',
          processingStatus: 'pending' as const
        },
        {
          description: 'failed to process',
          processingStatus: 'failed' as const
        }
      ])(
        'excludes an activity that is $description',
        async ({ processingStatus }) => {
          const gear = await database.createFitnessGear({
            actorId: actors.followRequester.id,
            kind: 'bike',
            name: `Rollup exclude ${processingStatus}`
          })
          await createActivity(database, {
            actorId: actors.followRequester.id,
            pathSuffix: `rollup-exclude-${processingStatus}`,
            distanceMeters: 9_000,
            activityStartTime: new Date('2026-04-10T08:00:00.000Z'),
            gearId: gear.id,
            processingStatus
          })

          const rollups = await database.getFitnessGearDistanceRollups({
            actorId: actors.followRequester.id,
            gearIds: [gear.id]
          })
          expect(rollups[gear.id]).toEqual({
            distanceMeters: 0,
            activityCount: 0
          })
        }
      )

      it('excludes a non-primary duplicate of the same ride', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.followRequester.id,
          kind: 'bike',
          name: 'Rollup non primary'
        })
        await createActivity(database, {
          actorId: actors.followRequester.id,
          pathSuffix: 'rollup-secondary',
          distanceMeters: 7_000,
          activityStartTime: new Date('2026-04-11T08:00:00.000Z'),
          gearId: gear.id,
          isPrimary: false
        })

        const rollups = await database.getFitnessGearDistanceRollups({
          actorId: actors.followRequester.id,
          gearIds: [gear.id]
        })
        expect(rollups[gear.id]).toEqual({
          distanceMeters: 0,
          activityCount: 0
        })
      })

      it('excludes a deleted activity', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.followRequester.id,
          kind: 'bike',
          name: 'Rollup deleted activity'
        })
        const activity = await createActivity(database, {
          actorId: actors.followRequester.id,
          pathSuffix: 'rollup-deleted',
          distanceMeters: 11_000,
          activityStartTime: new Date('2026-04-12T08:00:00.000Z'),
          gearId: gear.id
        })
        await database.deleteFitnessFile({ id: activity.id })

        const rollups = await database.getFitnessGearDistanceRollups({
          actorId: actors.followRequester.id,
          gearIds: [gear.id]
        })
        expect(rollups[gear.id]).toEqual({
          distanceMeters: 0,
          activityCount: 0
        })
      })

      it('returns an empty map when asked for no gear', async () => {
        const rollups = await database.getFitnessGearDistanceRollups({
          actorId: actors.primary.id,
          gearIds: []
        })
        expect(rollups).toEqual({})
      })
    })

    describe('component install windows', () => {
      it('counts only the activities inside each component window', async () => {
        const bike = await database.createFitnessGear({
          actorId: actors.empty.id,
          kind: 'bike',
          name: 'Window bike'
        })

        // Three rides, one per month.
        await createActivity(database, {
          actorId: actors.empty.id,
          pathSuffix: 'window-jan',
          distanceMeters: 10_000,
          activityStartTime: new Date('2026-01-15T08:00:00.000Z'),
          gearId: bike.id
        })
        await createActivity(database, {
          actorId: actors.empty.id,
          pathSuffix: 'window-feb',
          distanceMeters: 20_000,
          activityStartTime: new Date('2026-02-15T08:00:00.000Z'),
          gearId: bike.id
        })
        await createActivity(database, {
          actorId: actors.empty.id,
          pathSuffix: 'window-mar',
          distanceMeters: 40_000,
          activityStartTime: new Date('2026-03-15T08:00:00.000Z'),
          gearId: bike.id
        })

        const sinceBeginning = await database.createFitnessGearComponent({
          gearId: bike.id,
          actorId: actors.empty.id,
          componentType: 'Frame'
        })
        const installedFebruary = await database.createFitnessGearComponent({
          gearId: bike.id,
          actorId: actors.empty.id,
          componentType: 'Chain',
          addedAt: new Date('2026-02-01T00:00:00.000Z')
        })
        const replacedInMarch = await database.createFitnessGearComponent({
          gearId: bike.id,
          actorId: actors.empty.id,
          componentType: 'Cassette',
          addedAt: new Date('2026-02-01T00:00:00.000Z'),
          removedAt: new Date('2026-03-01T00:00:00.000Z')
        })

        const rollups = await database.getFitnessGearComponentDistanceRollups({
          actorId: actors.empty.id,
          gearIds: [bike.id]
        })

        expect(rollups[sinceBeginning!.id]).toEqual({
          distanceMeters: 70_000,
          activityCount: 3
        })
        expect(rollups[installedFebruary!.id]).toEqual({
          distanceMeters: 60_000,
          activityCount: 2
        })
        expect(rollups[replacedInMarch!.id]).toEqual({
          distanceMeters: 20_000,
          activityCount: 1
        })
      })

      it('gives an undated activity only to components whose window is open on that side', async () => {
        // An activity with no timestamp cannot be placed inside a dated window,
        // so a part fitted on a date must not claim it — even though the gear
        // total does count it. A gear total legitimately exceeding the sum of
        // its components is the documented consequence, not a bug.
        const bike = await database.createFitnessGear({
          actorId: actors.followRequester.id,
          kind: 'bike',
          name: 'Undated window bike'
        })
        await createActivity(database, {
          actorId: actors.followRequester.id,
          pathSuffix: 'undated-window',
          distanceMeters: 12_000,
          gearId: bike.id
        })

        const sinceBeginning = await database.createFitnessGearComponent({
          gearId: bike.id,
          actorId: actors.followRequester.id,
          componentType: 'Frame'
        })
        const fittedOnADate = await database.createFitnessGearComponent({
          gearId: bike.id,
          actorId: actors.followRequester.id,
          componentType: 'Chain',
          addedAt: new Date('2026-01-01T00:00:00.000Z')
        })

        const rollups = await database.getFitnessGearComponentDistanceRollups({
          actorId: actors.followRequester.id,
          gearIds: [bike.id]
        })
        expect(rollups[sinceBeginning!.id]).toEqual({
          distanceMeters: 12_000,
          activityCount: 1
        })
        expect(rollups[fittedOnADate!.id]).toEqual({
          distanceMeters: 0,
          activityCount: 0
        })

        const gearRollups = await database.getFitnessGearDistanceRollups({
          actorId: actors.followRequester.id,
          gearIds: [bike.id]
        })
        expect(gearRollups[bike.id].distanceMeters).toBe(12_000)
      })

      it('treats the window as half-open: the added instant counts, the removed instant does not', async () => {
        const bike = await database.createFitnessGear({
          actorId: actors.empty.id,
          kind: 'bike',
          name: 'Boundary bike'
        })
        const boundary = new Date('2026-06-01T00:00:00.000Z')

        await createActivity(database, {
          actorId: actors.empty.id,
          pathSuffix: 'boundary-exact',
          distanceMeters: 30_000,
          activityStartTime: boundary,
          gearId: bike.id
        })

        const addedAtBoundary = await database.createFitnessGearComponent({
          gearId: bike.id,
          actorId: actors.empty.id,
          componentType: 'Pedals',
          addedAt: boundary
        })
        const removedAtBoundary = await database.createFitnessGearComponent({
          gearId: bike.id,
          actorId: actors.empty.id,
          componentType: 'Saddle',
          removedAt: boundary
        })

        const rollups = await database.getFitnessGearComponentDistanceRollups({
          actorId: actors.empty.id,
          gearIds: [bike.id]
        })

        expect(rollups[addedAtBoundary!.id]).toEqual({
          distanceMeters: 30_000,
          activityCount: 1
        })
        expect(rollups[removedAtBoundary!.id]).toEqual({
          distanceMeters: 0,
          activityCount: 0
        })
      })

      it('does not count another gear’s activities', async () => {
        const first = await database.createFitnessGear({
          actorId: actors.pollAuthor.id,
          kind: 'bike',
          name: 'Isolation first'
        })
        const second = await database.createFitnessGear({
          actorId: actors.pollAuthor.id,
          kind: 'bike',
          name: 'Isolation second'
        })
        await createActivity(database, {
          actorId: actors.pollAuthor.id,
          pathSuffix: 'isolation-second',
          distanceMeters: 15_000,
          activityStartTime: new Date('2026-05-01T08:00:00.000Z'),
          gearId: second.id
        })

        const component = await database.createFitnessGearComponent({
          gearId: first.id,
          actorId: actors.pollAuthor.id,
          componentType: 'Chain'
        })

        const rollups = await database.getFitnessGearComponentDistanceRollups({
          actorId: actors.pollAuthor.id,
          gearIds: [first.id]
        })
        expect(rollups[component!.id]).toEqual({
          distanceMeters: 0,
          activityCount: 0
        })
      })
    })

    describe('gear components', () => {
      it('rejects a component on another actor’s gear', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'bike',
          name: 'Component ownership'
        })

        const created = await database.createFitnessGearComponent({
          gearId: gear.id,
          actorId: actors.replyAuthor.id,
          componentType: 'Chain'
        })
        expect(created).toBeNull()
      })

      it('lists installed components before replaced ones', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'bike',
          name: 'Component ordering'
        })
        await database.createFitnessGearComponent({
          gearId: gear.id,
          actorId: actors.primary.id,
          componentType: 'Old chain',
          removedAt: new Date('2026-01-01T00:00:00.000Z')
        })
        await database.createFitnessGearComponent({
          gearId: gear.id,
          actorId: actors.primary.id,
          componentType: 'Current chain'
        })

        const components = await database.getFitnessGearComponents({
          gearId: gear.id,
          actorId: actors.primary.id
        })
        expect(components.map((item) => item.componentType)).toEqual([
          'Current chain',
          'Old chain'
        ])
      })

      it('soft-deletes a component', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'bike',
          name: 'Component delete'
        })
        const component = await database.createFitnessGearComponent({
          gearId: gear.id,
          actorId: actors.primary.id,
          componentType: 'Stem'
        })

        expect(
          await database.deleteFitnessGearComponent({
            id: component!.id,
            gearId: gear.id,
            actorId: actors.replyAuthor.id
          })
        ).toBe(false)
        expect(
          await database.deleteFitnessGearComponent({
            id: component!.id,
            gearId: gear.id,
            actorId: actors.primary.id
          })
        ).toBe(true)

        const components = await database.getFitnessGearComponents({
          gearId: gear.id,
          actorId: actors.primary.id
        })
        expect(components.some((item) => item.id === component!.id)).toBe(false)
      })
    })

    describe('replaceFitnessGearComponent', () => {
      it('closes the old part today and opens a fresh one carrying the service interval', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'bike',
          name: 'Replace chain'
        })
        const original = await database.createFitnessGearComponent({
          gearId: gear.id,
          actorId: actors.primary.id,
          componentType: 'Chain',
          brand: 'KMC',
          model: 'X11EL Gold',
          serviceDistanceMeters: 5_000_000
        })

        const result = await database.replaceFitnessGearComponent({
          id: original!.id,
          gearId: gear.id,
          actorId: actors.primary.id
        })

        expect(result?.retired.removedAt).toEqual(expect.any(Number))
        expect(result?.replacement).toMatchObject({
          componentType: 'Chain',
          serviceDistanceMeters: 5_000_000
        })
        expect(result?.replacement.removedAt).toBeUndefined()
        expect(result?.replacement.addedAt).toEqual(expect.any(Number))
        expect(result?.replacement.brand).toBeUndefined()
        expect(result?.replacement.lastAlertedDistanceMeters).toBeUndefined()
      })

      it('returns null when the part was already replaced', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'bike',
          name: 'Replace twice'
        })
        const original = await database.createFitnessGearComponent({
          gearId: gear.id,
          actorId: actors.primary.id,
          componentType: 'Rear tire'
        })

        await database.replaceFitnessGearComponent({
          id: original!.id,
          gearId: gear.id,
          actorId: actors.primary.id
        })
        const second = await database.replaceFitnessGearComponent({
          id: original!.id,
          gearId: gear.id,
          actorId: actors.primary.id
        })
        expect(second).toBeNull()
      })

      it('returns null for another actor', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'bike',
          name: 'Replace foreign'
        })
        const original = await database.createFitnessGearComponent({
          gearId: gear.id,
          actorId: actors.primary.id,
          componentType: 'Fork'
        })

        const result = await database.replaceFitnessGearComponent({
          id: original!.id,
          gearId: gear.id,
          actorId: actors.replyAuthor.id
        })
        expect(result).toBeNull()
      })
    })

    describe('findFitnessGearByDefaultSport', () => {
      it('finds the active gear holding the sport', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.empty.id,
          kind: 'shoes',
          name: 'Default sport shoes',
          defaultSports: ['trail_run']
        })

        const found = await database.findFitnessGearByDefaultSport({
          actorId: actors.empty.id,
          sportKey: 'trail_run'
        })
        expect(found?.id).toBe(gear.id)
      })

      it('ignores retired gear', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.empty.id,
          kind: 'shoes',
          name: 'Retired default sport',
          defaultSports: ['walk']
        })
        await database.setFitnessGearRetired({
          id: gear.id,
          actorId: actors.empty.id,
          retired: true
        })

        const found = await database.findFitnessGearByDefaultSport({
          actorId: actors.empty.id,
          sportKey: 'walk'
        })
        expect(found).toBeNull()
      })

      it('ignores deleted gear', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.empty.id,
          kind: 'shoes',
          name: 'Deleted default sport',
          defaultSports: ['hike']
        })
        await database.deleteFitnessGear({
          id: gear.id,
          actorId: actors.empty.id
        })

        const found = await database.findFitnessGearByDefaultSport({
          actorId: actors.empty.id,
          sportKey: 'hike'
        })
        expect(found).toBeNull()
      })
    })

    describe('findFitnessGearByName', () => {
      it('matches a name case-insensitively', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.extra.id,
          kind: 'shoes',
          name: 'On Cloud Waterproof'
        })

        expect(
          (
            await database.findFitnessGearByName({
              actorId: actors.extra.id,
              name: '  on cloud waterproof '
            })
          )?.id
        ).toBe(gear.id)
      })
    })

    describe('setFitnessFileGear', () => {
      it('assigns, reassigns and clears the gear on an activity', async () => {
        const first = await database.createFitnessGear({
          actorId: actors.extra.id,
          kind: 'bike',
          name: 'Assign first'
        })
        const second = await database.createFitnessGear({
          actorId: actors.extra.id,
          kind: 'bike',
          name: 'Assign second'
        })
        const activity = await createActivity(database, {
          actorId: actors.extra.id,
          pathSuffix: 'assign',
          distanceMeters: 8_000,
          activityStartTime: new Date('2026-07-01T08:00:00.000Z')
        })

        expect(
          await database.setFitnessFileGear({
            fitnessFileId: activity.id,
            actorId: actors.extra.id,
            gearId: first.id
          })
        ).toEqual({ id: activity.id, gearId: first.id })

        await database.setFitnessFileGear({
          fitnessFileId: activity.id,
          actorId: actors.extra.id,
          gearId: second.id
        })
        expect(
          (await database.getFitnessFile({ id: activity.id }))?.gearId
        ).toBe(second.id)

        await database.setFitnessFileGear({
          fitnessFileId: activity.id,
          actorId: actors.extra.id,
          gearId: null
        })
        expect(
          (await database.getFitnessFile({ id: activity.id }))?.gearId
        ).toBeUndefined()
      })

      it('allows assigning retired gear so old activities can still be attributed', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.extra.id,
          kind: 'bike',
          name: 'Retired but assignable'
        })
        await database.setFitnessGearRetired({
          id: gear.id,
          actorId: actors.extra.id,
          retired: true
        })
        const activity = await createActivity(database, {
          actorId: actors.extra.id,
          pathSuffix: 'assign-retired',
          distanceMeters: 4_000,
          activityStartTime: new Date('2026-07-02T08:00:00.000Z')
        })

        expect(
          await database.setFitnessFileGear({
            fitnessFileId: activity.id,
            actorId: actors.extra.id,
            gearId: gear.id
          })
        ).toEqual({ id: activity.id, gearId: gear.id })
      })

      it.each([
        {
          description: 'the activity belongs to someone else',
          foreignFile: true
        },
        { description: 'the gear belongs to someone else', foreignFile: false }
      ])('returns null when $description', async ({ foreignFile }) => {
        const ownGear = await database.createFitnessGear({
          actorId: actors.extra.id,
          kind: 'bike',
          name: `Assign guard ${String(foreignFile)}`
        })
        const foreignGear = await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'bike',
          name: `Assign guard foreign ${String(foreignFile)}`
        })
        const activity = await createActivity(database, {
          actorId: actors.extra.id,
          pathSuffix: `assign-guard-${String(foreignFile)}`,
          distanceMeters: 3_000
        })

        const result = await database.setFitnessFileGear({
          fitnessFileId: activity.id,
          actorId: foreignFile ? actors.replyAuthor.id : actors.extra.id,
          gearId: foreignFile ? ownGear.id : foreignGear.id
        })
        expect(result).toBeNull()
        expect(
          (await database.getFitnessFile({ id: activity.id }))?.gearId
        ).toBeUndefined()
      })

      it('deleted gear cannot be assigned', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.extra.id,
          kind: 'bike',
          name: 'Assign deleted'
        })
        await database.deleteFitnessGear({
          id: gear.id,
          actorId: actors.extra.id
        })
        const activity = await createActivity(database, {
          actorId: actors.extra.id,
          pathSuffix: 'assign-deleted',
          distanceMeters: 2_000
        })

        expect(
          await database.setFitnessFileGear({
            fitnessFileId: activity.id,
            actorId: actors.extra.id,
            gearId: gear.id
          })
        ).toBeNull()
      })
    })

    describe('assignFitnessFileGearIfUnset', () => {
      it('assigns when the activity has no gear yet', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.empty.id,
          kind: 'bike',
          name: 'If unset assign'
        })
        const activity = await createActivity(database, {
          actorId: actors.empty.id,
          pathSuffix: 'if-unset',
          distanceMeters: 6_000
        })

        expect(
          await database.assignFitnessFileGearIfUnset({
            fitnessFileId: activity.id,
            actorId: actors.empty.id,
            gearId: gear.id
          })
        ).toBe(true)
        expect(
          (await database.getFitnessFile({ id: activity.id }))?.gearId
        ).toBe(gear.id)
      })

      it('refuses gear belonging to another actor', async () => {
        const foreignGear = await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'bike',
          name: 'If unset foreign gear'
        })
        const activity = await createActivity(database, {
          actorId: actors.empty.id,
          pathSuffix: 'if-unset-foreign',
          distanceMeters: 6_000
        })

        expect(
          await database.assignFitnessFileGearIfUnset({
            fitnessFileId: activity.id,
            actorId: actors.empty.id,
            gearId: foreignGear.id
          })
        ).toBe(false)
        expect(
          (await database.getFitnessFile({ id: activity.id }))?.gearId
        ).toBeUndefined()
      })

      it('accepts retired gear, so an import can attribute a ride to a sold bike', async () => {
        // Guards the EXISTS subquery against a future "hardening" pass adding
        // `whereNull('retiredAt')` to it: retiring means "stop suggesting this",
        // not "refuse to record history against it".
        const gear = await database.createFitnessGear({
          actorId: actors.empty.id,
          kind: 'bike',
          name: 'If unset retired gear'
        })
        await database.setFitnessGearRetired({
          id: gear.id,
          actorId: actors.empty.id,
          retired: true
        })
        const activity = await createActivity(database, {
          actorId: actors.empty.id,
          pathSuffix: 'if-unset-retired',
          distanceMeters: 6_000
        })

        expect(
          await database.assignFitnessFileGearIfUnset({
            fitnessFileId: activity.id,
            actorId: actors.empty.id,
            gearId: gear.id
          })
        ).toBe(true)
      })

      it('refuses an activity belonging to another actor', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.empty.id,
          kind: 'bike',
          name: 'If unset foreign file gear'
        })
        const activity = await createActivity(database, {
          actorId: actors.primary.id,
          pathSuffix: 'if-unset-foreign-file',
          distanceMeters: 6_000
        })

        expect(
          await database.assignFitnessFileGearIfUnset({
            fitnessFileId: activity.id,
            actorId: actors.empty.id,
            gearId: gear.id
          })
        ).toBe(false)
        expect(
          (await database.getFitnessFile({ id: activity.id }))?.gearId
        ).toBeUndefined()
      })

      it('refuses gear that has been deleted', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.empty.id,
          kind: 'bike',
          name: 'If unset deleted gear'
        })
        await database.deleteFitnessGear({
          id: gear.id,
          actorId: actors.empty.id
        })
        const activity = await createActivity(database, {
          actorId: actors.empty.id,
          pathSuffix: 'if-unset-deleted',
          distanceMeters: 6_000
        })

        expect(
          await database.assignFitnessFileGearIfUnset({
            fitnessFileId: activity.id,
            actorId: actors.empty.id,
            gearId: gear.id
          })
        ).toBe(false)
      })

      it('never overwrites an existing assignment', async () => {
        const manual = await database.createFitnessGear({
          actorId: actors.empty.id,
          kind: 'bike',
          name: 'If unset manual'
        })
        const auto = await database.createFitnessGear({
          actorId: actors.empty.id,
          kind: 'bike',
          name: 'If unset auto'
        })
        const activity = await createActivity(database, {
          actorId: actors.empty.id,
          pathSuffix: 'if-unset-manual',
          distanceMeters: 6_000,
          gearId: manual.id
        })

        expect(
          await database.assignFitnessFileGearIfUnset({
            fitnessFileId: activity.id,
            actorId: actors.empty.id,
            gearId: auto.id
          })
        ).toBe(false)
        expect(
          (await database.getFitnessFile({ id: activity.id }))?.gearId
        ).toBe(manual.id)
      })
    })

    describe('component rollup activity filter', () => {
      // The window logic has its own tests above; this covers the predicate the
      // component rollup shares with the gear rollup, which was otherwise
      // unguarded — removing any of the three filters left the suite green.
      it.each([
        {
          description: 'is still processing',
          processingStatus: 'pending' as const,
          isPrimary: true,
          deleted: false
        },
        {
          description: 'failed to process',
          processingStatus: 'failed' as const,
          isPrimary: true,
          deleted: false
        },
        {
          description: 'is a non-primary duplicate',
          processingStatus: 'completed' as const,
          isPrimary: false,
          deleted: false
        },
        {
          description: 'has been deleted',
          processingStatus: 'completed' as const,
          isPrimary: true,
          deleted: true
        }
      ])(
        'excludes an activity that $description',
        async ({ processingStatus, isPrimary, deleted, description }) => {
          const suffix = description.replace(/[^a-z]/gi, '')
          const bike = await database.createFitnessGear({
            actorId: actors.replyAuthor.id,
            kind: 'bike',
            name: `Component filter ${suffix}`
          })
          const component = await database.createFitnessGearComponent({
            gearId: bike.id,
            actorId: actors.replyAuthor.id,
            componentType: 'Chain'
          })
          const activity = await createActivity(database, {
            actorId: actors.replyAuthor.id,
            pathSuffix: `component-filter-${suffix}`,
            distanceMeters: 25_000,
            activityStartTime: new Date('2026-08-01T08:00:00.000Z'),
            gearId: bike.id,
            processingStatus,
            isPrimary
          })
          if (deleted) {
            await database.deleteFitnessFile({ id: activity.id })
          }

          const rollups = await database.getFitnessGearComponentDistanceRollups(
            {
              actorId: actors.replyAuthor.id,
              gearIds: [bike.id]
            }
          )
          expect(rollups[component!.id]).toEqual({
            distanceMeters: 0,
            activityCount: 0
          })
        }
      )

      it('excludes a soft-deleted component from the map entirely', async () => {
        const bike = await database.createFitnessGear({
          actorId: actors.replyAuthor.id,
          kind: 'bike',
          name: 'Component filter deleted component'
        })
        const component = await database.createFitnessGearComponent({
          gearId: bike.id,
          actorId: actors.replyAuthor.id,
          componentType: 'Chain'
        })
        await database.deleteFitnessGearComponent({
          id: component!.id,
          gearId: bike.id,
          actorId: actors.replyAuthor.id
        })

        const rollups = await database.getFitnessGearComponentDistanceRollups({
          actorId: actors.replyAuthor.id,
          gearIds: [bike.id]
        })
        expect(component!.id in rollups).toBe(false)
      })

      it('returns nothing for another actor’s gear', async () => {
        const bike = await database.createFitnessGear({
          actorId: actors.replyAuthor.id,
          kind: 'bike',
          name: 'Component filter foreign'
        })
        await database.createFitnessGearComponent({
          gearId: bike.id,
          actorId: actors.replyAuthor.id,
          componentType: 'Chain'
        })

        const rollups = await database.getFitnessGearComponentDistanceRollups({
          actorId: actors.primary.id,
          gearIds: [bike.id]
        })
        expect(rollups).toEqual({})
      })
    })

    describe('updateFitnessGearComponent', () => {
      it('updates only the fields given and leaves the rest alone', async () => {
        const bike = await database.createFitnessGear({
          actorId: actors.pollAuthor.id,
          kind: 'bike',
          name: 'Component update bike'
        })
        const component = await database.createFitnessGearComponent({
          gearId: bike.id,
          actorId: actors.pollAuthor.id,
          componentType: 'Chain',
          brand: 'KMC',
          serviceDistanceMeters: 5_000_000
        })

        const updated = await database.updateFitnessGearComponent({
          id: component!.id,
          gearId: bike.id,
          actorId: actors.pollAuthor.id,
          model: 'X11EL'
        })
        expect(updated).toMatchObject({
          componentType: 'Chain',
          brand: 'KMC',
          model: 'X11EL',
          serviceDistanceMeters: 5_000_000
        })
      })

      it('re-arms the reminder when the service interval changes', async () => {
        const bike = await database.createFitnessGear({
          actorId: actors.pollAuthor.id,
          kind: 'bike',
          name: 'Component re-arm bike'
        })
        const component = await database.createFitnessGearComponent({
          gearId: bike.id,
          actorId: actors.pollAuthor.id,
          componentType: 'Cassette',
          serviceDistanceMeters: 5_000_000
        })
        await database.setFitnessGearComponentLastAlertedDistance({
          id: component!.id,
          lastAlertedDistanceMeters: 5_100_000
        })

        const updated = await database.updateFitnessGearComponent({
          id: component!.id,
          gearId: bike.id,
          actorId: actors.pollAuthor.id,
          serviceDistanceMeters: 8_000_000
        })
        expect(updated?.lastAlertedDistanceMeters).toBeUndefined()
      })

      it('returns null for another actor’s component', async () => {
        const bike = await database.createFitnessGear({
          actorId: actors.pollAuthor.id,
          kind: 'bike',
          name: 'Component update foreign'
        })
        const component = await database.createFitnessGearComponent({
          gearId: bike.id,
          actorId: actors.pollAuthor.id,
          componentType: 'Fork'
        })

        expect(
          await database.updateFitnessGearComponent({
            id: component!.id,
            gearId: bike.id,
            actorId: actors.primary.id,
            brand: 'Hijacked'
          })
        ).toBeNull()
      })
    })

    describe('conditional alert claims', () => {
      it('lets only the first of two concurrent claims through', async () => {
        const shoes = await database.createFitnessGear({
          actorId: actors.pollAuthor.id,
          kind: 'shoes',
          name: 'Claim race shoes',
          alertDistanceMeters: 650_000
        })

        expect(
          await database.setFitnessGearLastAlertedDistance({
            id: shoes.id,
            lastAlertedDistanceMeters: 651_000,
            onlyIfBelowThresholdMeters: 650_000
          })
        ).toBe(true)
        // The second evaluation read the same stale null, but the write itself
        // now sees the recorded distance and declines.
        expect(
          await database.setFitnessGearLastAlertedDistance({
            id: shoes.id,
            lastAlertedDistanceMeters: 652_000,
            onlyIfBelowThresholdMeters: 650_000
          })
        ).toBe(false)
      })

      it('claims again once the threshold is raised past the recorded distance', async () => {
        const shoes = await database.createFitnessGear({
          actorId: actors.pollAuthor.id,
          kind: 'shoes',
          name: 'Claim re-arm shoes',
          alertDistanceMeters: 650_000
        })
        await database.setFitnessGearLastAlertedDistance({
          id: shoes.id,
          lastAlertedDistanceMeters: 651_000,
          onlyIfBelowThresholdMeters: 650_000
        })

        expect(
          await database.setFitnessGearLastAlertedDistance({
            id: shoes.id,
            lastAlertedDistanceMeters: 810_000,
            onlyIfBelowThresholdMeters: 800_000
          })
        ).toBe(true)
      })
    })

    describe('getFitnessGearNamesByIds', () => {
      it('maps ids to names and skips deleted gear', async () => {
        const live = await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'bike',
          name: 'Name lookup live'
        })
        const removed = await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'bike',
          name: 'Name lookup deleted'
        })
        await database.deleteFitnessGear({
          id: removed.id,
          actorId: actors.primary.id
        })

        const names = await database.getFitnessGearNamesByIds({
          ids: [live.id, removed.id, live.id]
        })
        expect(names).toEqual({ [live.id]: 'Name lookup live' })
      })

      it('returns an empty map for no ids', async () => {
        expect(await database.getFitnessGearNamesByIds({ ids: [] })).toEqual({})
      })
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
          processingStatus = 'completed',
          isPrimary = true
        }: {
          actorId: string
          pathSuffix: string
          distanceMeters: number
          activityStartTime?: Date
          deviceGearId?: string
          processingStatus?: 'pending' | 'processing' | 'completed' | 'failed'
          isPrimary?: boolean
        }
      ) => {
        const file = await db.createFitnessFile({
          actorId,
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

        it('applies the same countable-activity filter the distance rollups use', async () => {
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
          expect(rollups[device.id].activityCount).toBe(1)
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
          expect(deviceRows[0]).toMatchObject({
            totalDistanceMeters: 42_600,
            activityType: 'cycling',
            activityStartTime: new Date('2026-06-01T08:00:00.000Z').getTime(),
            statusId: null,
            statusPublicId: null
          })

          const bikeRows = await database.getFitnessGearActivities({
            actorId: actors.extra.id,
            gearId: bike.id,
            kind: 'bike',
            limit: 10
          })
          expect(bikeRows.map((row) => row.id)).toEqual([onBike.id])
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
          // PostgreSQL puts NULLs first under DESC and SQLite puts them last;
          // `nulls: 'last'` is what makes this assertion hold on both.
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
          for (let index = 0; index < 5; index += 1) {
            await createDeviceActivity(database, {
              actorId: actors.pollAuthor.id,
              pathSuffix: `page-${index}`,
              distanceMeters: 1_000 * (index + 1),
              activityStartTime: new Date(
                Date.UTC(2026, 7, index + 1, 8, 0, 0)
              ),
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
