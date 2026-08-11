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

    describe('findFitnessGearByStravaGearId and findFitnessGearByName', () => {
      it('finds gear by its Strava id, scoped to the actor', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.extra.id,
          kind: 'bike',
          name: 'Strava keyed',
          stravaGearId: 'b1234567'
        })

        expect(
          (
            await database.findFitnessGearByStravaGearId({
              actorId: actors.extra.id,
              stravaGearId: 'b1234567'
            })
          )?.id
        ).toBe(gear.id)
        expect(
          await database.findFitnessGearByStravaGearId({
            actorId: actors.primary.id,
            stravaGearId: 'b1234567'
          })
        ).toBeNull()
      })

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

    describe('deleting gear releases its Strava id', () => {
      it('lets a later import re-create gear for the same Strava id', async () => {
        const original = await database.createFitnessGear({
          actorId: actors.extra.id,
          kind: 'bike',
          name: 'Strava bike',
          stravaGearId: 'b7654321'
        })
        await database.deleteFitnessGear({
          id: original.id,
          actorId: actors.extra.id
        })

        // The unique index on (actorId, stravaGearId) covers soft-deleted rows,
        // so a deleted gear that kept its id would make this insert fail
        // forever and leave every future activity on that bike unattributed.
        const reimported = await database.createFitnessGear({
          actorId: actors.extra.id,
          kind: 'bike',
          name: 'Strava bike',
          stravaGearId: 'b7654321'
        })
        expect(reimported.id).not.toBe(original.id)
        expect(
          (
            await database.findFitnessGearByStravaGearId({
              actorId: actors.extra.id,
              stravaGearId: 'b7654321'
            })
          )?.id
        ).toBe(reimported.id)
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
  })
})
