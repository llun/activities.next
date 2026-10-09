import { createActivity } from '@/lib/database/sql/fitnessGearTestHelpers'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
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
      it('refuses to auto-assign an activity to a recording device', async () => {
        // The same rule the explicit setter enforces, on the other writer.
        // Unreachable through auto-assign itself (a device holds no default
        // sport), but `scripts/fitness/importFitnessGear.ts` reaches here
        // through a NAME lookup that device rows share a namespace with.
        const device = await database.createFitnessGear({
          actorId: actors.extra.id,
          kind: 'device',
          name: 'Auto assign device',
          deviceKey: 'name:auto assign device'
        })
        const activity = await createActivity(database, {
          actorId: actors.extra.id,
          pathSuffix: 'auto-assign-device',
          distanceMeters: 8_000,
          activityStartTime: new Date('2026-07-06T08:00:00.000Z')
        })

        expect(
          await database.assignFitnessFileGearIfUnset({
            fitnessFileId: activity.id,
            actorId: actors.extra.id,
            gearId: device.id
          })
        ).toBe(false)

        const reloaded = await database.getFitnessFile({ id: activity.id })
        expect(reloaded?.gearId).toBeUndefined()
      })

      it('refuses to attribute an activity to a recording device', async () => {
        // `gearId` answers "what was this ride done on", which a head unit
        // never is. An activity pointed at one falls out of EVERY rollup: the
        // device rollups match on `deviceGearId`, and the distance rollups skip
        // devices entirely. The picker excludes devices, but this is the
        // enforcement point — the route takes a gear id straight from the body.
        const device = await database.createFitnessGear({
          actorId: actors.extra.id,
          kind: 'device',
          name: 'Not a bike',
          deviceKey: 'name:not a bike'
        })
        const activity = await createActivity(database, {
          actorId: actors.extra.id,
          pathSuffix: 'assign-device',
          distanceMeters: 8_000,
          activityStartTime: new Date('2026-07-05T08:00:00.000Z')
        })

        expect(
          await database.setFitnessFileGear({
            fitnessFileId: activity.id,
            actorId: actors.extra.id,
            gearId: device.id
          })
        ).toBeNull()

        const reloaded = await database.getFitnessFile({ id: activity.id })
        expect(reloaded?.gearId).toBeUndefined()
      })

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
