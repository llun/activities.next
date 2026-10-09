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

      it('creates and updates component with productUrl', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'bike',
          name: 'Component product url'
        })
        const component = await database.createFitnessGearComponent({
          gearId: gear.id,
          actorId: actors.primary.id,
          componentType: 'Chain',
          brand: 'Shimano',
          model: 'CN-M9100',
          productUrl: 'https://bike.shimano.com/product/cn-m9100.html'
        })
        expect(component?.productUrl).toBe(
          'https://bike.shimano.com/product/cn-m9100.html'
        )

        const updated = await database.updateFitnessGearComponent({
          id: component!.id,
          gearId: gear.id,
          actorId: actors.primary.id,
          productUrl: 'https://bike.shimano.com/updated'
        })
        expect(updated?.productUrl).toBe('https://bike.shimano.com/updated')

        const cleared = await database.updateFitnessGearComponent({
          id: component!.id,
          gearId: gear.id,
          actorId: actors.primary.id,
          productUrl: null
        })
        expect(cleared?.productUrl).toBeUndefined()
      })
    })

    describe('retireFitnessGearComponent', () => {
      it('closes the fitted part at today and does not create a new component', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'bike',
          name: 'Retire chain'
        })
        const original = await database.createFitnessGearComponent({
          gearId: gear.id,
          actorId: actors.primary.id,
          componentType: 'Chain',
          brand: 'KMC',
          model: 'X11EL Gold',
          serviceDistanceMeters: 5_000_000
        })

        const result = await database.retireFitnessGearComponent({
          id: original!.id,
          gearId: gear.id,
          actorId: actors.primary.id
        })

        expect(result?.id).toBe(original!.id)
        expect(result?.removedAt).toEqual(expect.any(Number))
        expect(result?.componentType).toBe('Chain')
        expect(result?.brand).toBe('KMC')
        expect(result?.model).toBe('X11EL Gold')
        expect(result?.serviceDistanceMeters).toBe(5_000_000)

        const components = await database.getFitnessGearComponents({
          gearId: gear.id,
          actorId: actors.primary.id
        })
        expect(components).toHaveLength(1)
        expect(components[0].removedAt).toEqual(expect.any(Number))
      })

      it('returns null when the part was already retired', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'bike',
          name: 'Retire twice'
        })
        const original = await database.createFitnessGearComponent({
          gearId: gear.id,
          actorId: actors.primary.id,
          componentType: 'Rear tire'
        })

        await database.retireFitnessGearComponent({
          id: original!.id,
          gearId: gear.id,
          actorId: actors.primary.id
        })
        const second = await database.retireFitnessGearComponent({
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
          name: 'Retire foreign'
        })
        const original = await database.createFitnessGearComponent({
          gearId: gear.id,
          actorId: actors.primary.id,
          componentType: 'Fork'
        })

        const result = await database.retireFitnessGearComponent({
          id: original!.id,
          gearId: gear.id,
          actorId: actors.replyAuthor.id
        })
        expect(result).toBeNull()
      })
    })

    describe('component install periods', () => {
      // The bug this table exists for, in the shape it was reported: a part
      // retired on 2026-02-01 and put back on later used to have its ORIGINAL
      // window reopened, so it was credited the 20 km ridden on 2026-02-15
      // while it sat off the bike — and retiring it again did not take that
      // back, because that only closes the window at the new today.
      //
      // The dates are all in the past and the refit opens its period at the
      // real today, so the 2026-02-15 ride is unambiguously in the gap: after
      // the first period's end and before the second period's start.
      it('does not credit a refitted part the activities ridden while it was off', async () => {
        const bike = await database.createFitnessGear({
          actorId: actors.empty.id,
          kind: 'bike',
          name: 'Refit bike'
        })
        const component = await database.createFitnessGearComponent({
          gearId: bike.id,
          actorId: actors.empty.id,
          componentType: 'Wheelset',
          addedAt: new Date('2026-01-01T00:00:00.000Z'),
          removedAt: new Date('2026-02-01T00:00:00.000Z')
        })

        // Ridden while fitted.
        await createActivity(database, {
          actorId: actors.empty.id,
          pathSuffix: 'refit-fitted',
          distanceMeters: 10_000,
          activityStartTime: new Date('2026-01-15T08:00:00.000Z'),
          gearId: bike.id
        })
        // Ridden on the bike while the wheelset was on the shelf.
        await createActivity(database, {
          actorId: actors.empty.id,
          pathSuffix: 'refit-gap',
          distanceMeters: 20_000,
          activityStartTime: new Date('2026-02-15T08:00:00.000Z'),
          gearId: bike.id
        })

        const refitted = await database.refitFitnessGearComponent({
          id: component!.id,
          gearId: bike.id,
          actorId: actors.empty.id
        })
        expect(refitted).not.toBeNull()
        // Fitted again, and the gap ride predates the new period.
        expect(refitted!.removedAt).toBeUndefined()
        expect(refitted!.periods[1].addedAt!).toBeGreaterThan(
          Date.parse('2026-02-15T08:00:00.000Z')
        )

        const rollups = await database.getFitnessGearComponentDistanceRollups({
          actorId: actors.empty.id,
          gearIds: [bike.id]
        })
        expect(rollups[component!.id]).toEqual({
          distanceMeters: 10_000,
          activityCount: 1
        })

        // And re-retiring does not silently absorb it either.
        await database.retireFitnessGearComponent({
          id: component!.id,
          gearId: bike.id,
          actorId: actors.empty.id
        })
        const afterRetire =
          await database.getFitnessGearComponentDistanceRollups({
            actorId: actors.empty.id,
            gearIds: [bike.id]
          })
        expect(afterRetire[component!.id]).toEqual({
          distanceMeters: 10_000,
          activityCount: 1
        })
      })

      it('counts an activity ridden after the refit, and only once', async () => {
        const bike = await database.createFitnessGear({
          actorId: actors.extra.id,
          kind: 'bike',
          name: 'Second period bike'
        })
        const component = await database.createFitnessGearComponent({
          gearId: bike.id,
          actorId: actors.extra.id,
          componentType: 'Wheelset',
          addedAt: new Date('2026-01-01T00:00:00.000Z'),
          removedAt: new Date('2026-02-01T00:00:00.000Z')
        })
        await database.refitFitnessGearComponent({
          id: component!.id,
          gearId: bike.id,
          actorId: actors.extra.id
        })

        // Inside the first period, and then well after the second one opened.
        await createActivity(database, {
          actorId: actors.extra.id,
          pathSuffix: 'second-period-first',
          distanceMeters: 10_000,
          activityStartTime: new Date('2026-01-15T08:00:00.000Z'),
          gearId: bike.id
        })
        await createActivity(database, {
          actorId: actors.extra.id,
          pathSuffix: 'second-period-latest',
          distanceMeters: 30_000,
          activityStartTime: new Date(Date.now() + 60_000),
          gearId: bike.id
        })

        const rollups = await database.getFitnessGearComponentDistanceRollups({
          actorId: actors.extra.id,
          gearIds: [bike.id]
        })
        // 40_000 rather than 50_000 or a doubled count: the two periods are
        // joined separately and an activity matches at most one of them.
        expect(rollups[component!.id]).toEqual({
          distanceMeters: 40_000,
          activityCount: 2
        })
      })

      // An open-on-both-sides period is the only one an undated activity can
      // fall in, and a refitted component has exactly one open period — so this
      // also proves the join cannot count such an activity twice.
      it('counts an undated activity once for a component that has been refitted', async () => {
        const bike = await database.createFitnessGear({
          actorId: actors.pollAuthor.id,
          kind: 'bike',
          name: 'Undated refit bike'
        })
        const component = await database.createFitnessGearComponent({
          gearId: bike.id,
          actorId: actors.pollAuthor.id,
          componentType: 'Frame'
        })
        await database.retireFitnessGearComponent({
          id: component!.id,
          gearId: bike.id,
          actorId: actors.pollAuthor.id
        })
        await database.refitFitnessGearComponent({
          id: component!.id,
          gearId: bike.id,
          actorId: actors.pollAuthor.id
        })
        await createActivity(database, {
          actorId: actors.pollAuthor.id,
          pathSuffix: 'undated-refit',
          distanceMeters: 5_000,
          gearId: bike.id
        })

        const rollups = await database.getFitnessGearComponentDistanceRollups({
          actorId: actors.pollAuthor.id,
          gearIds: [bike.id]
        })
        // The refit's period is `[now, null)`, which an undated activity cannot
        // be placed inside — only the first period, still open on both sides
        // after the retire reopened nothing, would take it. It does not, so the
        // count is 0 and certainly not 2.
        expect(rollups[component!.id]).toEqual({
          distanceMeters: 0,
          activityCount: 0
        })
      })

      it('reports the first period’s start and the last period’s end as the component window', async () => {
        const bike = await database.createFitnessGear({
          actorId: actors.followRequester.id,
          kind: 'bike',
          name: 'Derived window bike'
        })
        const component = await database.createFitnessGearComponent({
          gearId: bike.id,
          actorId: actors.followRequester.id,
          componentType: 'Chain',
          addedAt: new Date('2026-01-01T00:00:00.000Z'),
          removedAt: new Date('2026-02-01T00:00:00.000Z')
        })

        const refitted = await database.refitFitnessGearComponent({
          id: component!.id,
          gearId: bike.id,
          actorId: actors.followRequester.id
        })

        expect(refitted?.periods).toHaveLength(2)
        expect(
          refitted?.periods.map((period) => period.installSequence)
        ).toEqual([1, 2])
        // The FIRST period's start — the part went on in January, whatever has
        // happened since.
        expect(refitted?.addedAt).toEqual(
          Date.parse('2026-01-01T00:00:00.000Z')
        )
        // The LAST period's end, so a refitted part reads as fitted again.
        expect(refitted?.removedAt).toBeUndefined()
        expect(refitted?.periods[0].removedAt).toEqual(
          Date.parse('2026-02-01T00:00:00.000Z')
        )
        expect(refitted?.periods[1].addedAt).toBeDefined()
        expect(refitted?.periods[1].removedAt).toBeUndefined()
      })
    })

    describe('refitFitnessGearComponent', () => {
      const createRetiredComponent = async (actorId: string, name: string) => {
        const gear = await database.createFitnessGear({
          actorId,
          kind: 'bike',
          name
        })
        const component = await database.createFitnessGearComponent({
          gearId: gear.id,
          actorId,
          componentType: 'Chain',
          addedAt: new Date('2026-01-01T00:00:00.000Z'),
          removedAt: new Date('2026-02-01T00:00:00.000Z')
        })
        return { gear, component: component! }
      }

      it('opens a new period at today and leaves the closed one untouched', async () => {
        const { gear, component } = await createRetiredComponent(
          actors.primary.id,
          'Refit opens bike'
        )
        const before = Date.now()

        const result = await database.refitFitnessGearComponent({
          id: component.id,
          gearId: gear.id,
          actorId: actors.primary.id
        })

        expect(result?.periods).toHaveLength(2)
        // The closed period is exactly as it was — reopening it is the
        // retroactive credit this replaces.
        expect(result?.periods[0]).toMatchObject({
          installSequence: 1,
          addedAt: Date.parse('2026-01-01T00:00:00.000Z'),
          removedAt: Date.parse('2026-02-01T00:00:00.000Z')
        })
        expect(result?.periods[1].installSequence).toEqual(2)
        expect(result?.periods[1].removedAt).toBeUndefined()
        // Today, not the moment the part came off.
        expect(result?.periods[1].addedAt).toBeGreaterThanOrEqual(before)
      })

      it('returns null when the part is already fitted', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.primary.id,
          kind: 'bike',
          name: 'Already fitted bike'
        })
        const component = await database.createFitnessGearComponent({
          gearId: gear.id,
          actorId: actors.primary.id,
          componentType: 'Chain'
        })

        const result = await database.refitFitnessGearComponent({
          id: component!.id,
          gearId: gear.id,
          actorId: actors.primary.id
        })
        expect(result).toBeNull()

        // And nothing was opened behind that null.
        const components = await database.getFitnessGearComponents({
          gearId: gear.id,
          actorId: actors.primary.id
        })
        expect(components[0].periods).toHaveLength(1)
      })

      it('returns null for another actor', async () => {
        const { gear, component } = await createRetiredComponent(
          actors.primary.id,
          'Refit stranger bike'
        )

        const result = await database.refitFitnessGearComponent({
          id: component.id,
          gearId: gear.id,
          actorId: actors.replyAuthor.id
        })
        expect(result).toBeNull()
      })

      // Two tabs, or a retried request. What this pins is the INVARIANT — one
      // open period, one caller told "already fitted" — not the unique index
      // that protects it under a genuine interleave: on SQLite knex serializes
      // the two transactions, so the second one's own read already sees the
      // first's committed insert and returns through the ordinary branch. The
      // index itself is proved directly, at the raw-SQL level, by
      // `fitnessGearComponentPeriodsMigration.test.ts`'s "refuses a second open
      // period per component"; the mapping from that violation to "already
      // fitted" is `isUniqueConstraintError`, which has its own tests. Do not
      // read a pass here as proof that the catch path ran.
      it('opens exactly one period when two refits are issued together', async () => {
        const { gear, component } = await createRetiredComponent(
          actors.primary.id,
          'Refit race bike'
        )

        const results = await Promise.all([
          database.refitFitnessGearComponent({
            id: component.id,
            gearId: gear.id,
            actorId: actors.primary.id
          }),
          database.refitFitnessGearComponent({
            id: component.id,
            gearId: gear.id,
            actorId: actors.primary.id
          })
        ])

        const components = await database.getFitnessGearComponents({
          gearId: gear.id,
          actorId: actors.primary.id
        })
        expect(components[0].periods).toHaveLength(2)
        expect(
          components[0].periods.filter((period) => !period.removedAt)
        ).toHaveLength(1)
        // One caller opened it; the other is told the part is already fitted.
        expect(results.filter(Boolean)).toHaveLength(1)
      })

      it('round-trips retire and refit', async () => {
        const gear = await database.createFitnessGear({
          actorId: actors.extra.id,
          kind: 'bike',
          name: 'Round trip bike'
        })
        const component = await database.createFitnessGearComponent({
          gearId: gear.id,
          actorId: actors.extra.id,
          componentType: 'Chain'
        })

        const retired = await database.retireFitnessGearComponent({
          id: component!.id,
          gearId: gear.id,
          actorId: actors.extra.id
        })
        expect(retired?.removedAt).toBeDefined()
        expect(retired?.periods).toHaveLength(1)

        const refitted = await database.refitFitnessGearComponent({
          id: component!.id,
          gearId: gear.id,
          actorId: actors.extra.id
        })
        expect(refitted?.removedAt).toBeUndefined()
        expect(refitted?.periods).toHaveLength(2)

        const retiredAgain = await database.retireFitnessGearComponent({
          id: component!.id,
          gearId: gear.id,
          actorId: actors.extra.id
        })
        // Retiring again closes the SECOND period rather than reopening or
        // replacing the first.
        expect(retiredAgain?.periods).toHaveLength(2)
        expect(retiredAgain?.periods[1].removedAt).toBeDefined()
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
      // The dates are on the periods now, and the PATCH reaches only the
      // outermost bounds — the first period's start and the last period's end.
      // That is what those two fields have always meant for the component as a
      // whole, and it is why an edit cannot make two periods overlap.
      it('moves the first period’s start and the last period’s end', async () => {
        const bike = await database.createFitnessGear({
          actorId: actors.pollAuthor.id,
          kind: 'bike',
          name: 'Component bounds bike'
        })
        const component = await database.createFitnessGearComponent({
          gearId: bike.id,
          actorId: actors.pollAuthor.id,
          componentType: 'Chain',
          addedAt: new Date('2026-01-01T00:00:00.000Z'),
          removedAt: new Date('2026-02-01T00:00:00.000Z')
        })
        await database.refitFitnessGearComponent({
          id: component!.id,
          gearId: bike.id,
          actorId: actors.pollAuthor.id
        })

        const updated = await database.updateFitnessGearComponent({
          id: component!.id,
          gearId: bike.id,
          actorId: actors.pollAuthor.id,
          addedAt: new Date('2025-12-01T00:00:00.000Z'),
          removedAt: new Date('2030-09-01T00:00:00.000Z')
        })

        expect(updated?.periods).toHaveLength(2)
        expect(updated?.periods[0].addedAt).toEqual(
          Date.parse('2025-12-01T00:00:00.000Z')
        )
        // The middle bound is untouched, so the gap survives the edit.
        expect(updated?.periods[0].removedAt).toEqual(
          Date.parse('2026-02-01T00:00:00.000Z')
        )
        expect(updated?.periods[1].removedAt).toEqual(
          Date.parse('2030-09-01T00:00:00.000Z')
        )
      })

      // The route validates a date edit against the periods it READ, then this
      // method resolves the target again when it WRITES. A refit landing
      // between the two appends a new last period, so `removedAt` lands on a
      // row nobody checked — and writes a period no activity can fall inside,
      // which is the silent, permanent loss the whole table exists to prevent.
      //
      // Reachable without any interleave at all, because the write carried no
      // bound check of its own: handing it a date that inverts the current last
      // period was enough.
      it('refuses a removal date that would invert the period it lands on', async () => {
        const bike = await database.createFitnessGear({
          actorId: actors.pollAuthor.id,
          kind: 'bike',
          name: 'Component drift bike'
        })
        const component = await database.createFitnessGearComponent({
          gearId: bike.id,
          actorId: actors.pollAuthor.id,
          componentType: 'Chain',
          addedAt: new Date('2026-01-01T00:00:00.000Z'),
          removedAt: new Date('2026-03-01T00:00:00.000Z')
        })
        // The refit the racing caller never saw: a second period opening today.
        await database.refitFitnessGearComponent({
          id: component!.id,
          gearId: bike.id,
          actorId: actors.pollAuthor.id
        })

        const updated = await database.updateFitnessGearComponent({
          id: component!.id,
          gearId: bike.id,
          actorId: actors.pollAuthor.id,
          // Valid against the FIRST period, which is what a caller holding the
          // pre-refit snapshot would have checked it against.
          removedAt: new Date('2026-02-15T00:00:00.000Z')
        })

        // The second period is left open rather than inverted.
        expect(updated?.periods).toHaveLength(2)
        expect(updated?.periods[1].removedAt).toBeUndefined()
        expect(updated?.periods[1].addedAt).toBeGreaterThan(
          Date.parse('2026-02-15T00:00:00.000Z')
        )
        // And it still counts activities, which an inverted period never can.
        expect(updated?.removedAt).toBeUndefined()
      })

      // Both bounds land on the SAME row when a component has one period, and
      // each write's ordering predicate reads the row's stored state — so the
      // first write compares the new `addedAt` against the OLD `removedAt`,
      // which the second write is about to replace. Moving a window wholesale
      // is the case where that matters: every value is ordered, and the edit
      // must apply whole rather than half.
      it('moves both ends of a single period past the old window', async () => {
        const bike = await database.createFitnessGear({
          actorId: actors.pollAuthor.id,
          kind: 'bike',
          name: 'Component wholesale bike'
        })
        const component = await database.createFitnessGearComponent({
          gearId: bike.id,
          actorId: actors.pollAuthor.id,
          componentType: 'Chain',
          addedAt: new Date('2026-01-01T00:00:00.000Z'),
          removedAt: new Date('2026-03-01T00:00:00.000Z')
        })

        const updated = await database.updateFitnessGearComponent({
          id: component!.id,
          gearId: bike.id,
          actorId: actors.pollAuthor.id,
          addedAt: new Date('2026-04-01T00:00:00.000Z'),
          removedAt: new Date('2026-09-01T00:00:00.000Z')
        })

        expect(updated?.periods).toHaveLength(1)
        expect(updated?.periods[0].addedAt).toEqual(
          Date.parse('2026-04-01T00:00:00.000Z')
        )
        expect(updated?.periods[0].removedAt).toEqual(
          Date.parse('2026-09-01T00:00:00.000Z')
        )
      })

      // Clearing one bound while moving the other, on a component with a
      // single period — so both land on the same row and neither can be
      // checked against the other's stored value. An open side cannot invert
      // anything, which is why the guard is two negations; written as
      // `addedAt && removedAt && ...` it reads the same and is not, skipping
      // the write whenever either bound is cleared. That rewrite passes every
      // other test in this file.
      it.each([
        {
          description: 'moving the added date while clearing the removal date',
          addedAt: new Date('2026-06-01T00:00:00.000Z'),
          removedAt: null,
          expectedAddedAt: Date.parse('2026-06-01T00:00:00.000Z'),
          expectedRemovedAt: undefined
        },
        {
          description: 'clearing the added date while setting a removal date',
          addedAt: null,
          removedAt: new Date('2026-06-01T00:00:00.000Z'),
          expectedAddedAt: undefined,
          expectedRemovedAt: Date.parse('2026-06-01T00:00:00.000Z')
        },
        {
          description: 'clearing both bounds at once',
          addedAt: null,
          removedAt: null,
          expectedAddedAt: undefined,
          expectedRemovedAt: undefined
        }
      ])(
        'applies $description on a single period',
        async ({ addedAt, removedAt, expectedAddedAt, expectedRemovedAt }) => {
          const bike = await database.createFitnessGear({
            actorId: actors.extra.id,
            kind: 'bike',
            name: `Component open side bike ${String(addedAt)}${String(removedAt)}`
          })
          const component = await database.createFitnessGearComponent({
            gearId: bike.id,
            actorId: actors.extra.id,
            componentType: 'Chain',
            addedAt: new Date('2026-01-01T00:00:00.000Z'),
            removedAt: new Date('2026-03-01T00:00:00.000Z')
          })

          const updated = await database.updateFitnessGearComponent({
            id: component!.id,
            gearId: bike.id,
            actorId: actors.extra.id,
            addedAt,
            removedAt
          })

          expect(updated?.periods).toHaveLength(1)
          expect(updated?.periods[0].addedAt).toEqual(expectedAddedAt)
          expect(updated?.periods[0].removedAt).toEqual(expectedRemovedAt)
        }
      )

      // Three periods: the joint-write branch must NOT fire (first and last are
      // different rows), and the middle period is unreachable from this edit
      // and must come through untouched — it is the one nothing re-examines.
      it('edits only the outer periods of a twice-refitted component', async () => {
        const bike = await database.createFitnessGear({
          actorId: actors.extra.id,
          kind: 'bike',
          name: 'Component three period bike'
        })
        const component = await database.createFitnessGearComponent({
          gearId: bike.id,
          actorId: actors.extra.id,
          componentType: 'Chain',
          addedAt: new Date('2026-01-01T00:00:00.000Z'),
          removedAt: new Date('2026-02-01T00:00:00.000Z')
        })
        await database.refitFitnessGearComponent({
          id: component!.id,
          gearId: bike.id,
          actorId: actors.extra.id
        })
        await database.retireFitnessGearComponent({
          id: component!.id,
          gearId: bike.id,
          actorId: actors.extra.id
        })
        await database.refitFitnessGearComponent({
          id: component!.id,
          gearId: bike.id,
          actorId: actors.extra.id
        })

        const before = await database.getFitnessGearComponents({
          gearId: bike.id,
          actorId: actors.extra.id
        })
        expect(before[0].periods).toHaveLength(3)
        const middleBefore = before[0].periods[1]

        const updated = await database.updateFitnessGearComponent({
          id: component!.id,
          gearId: bike.id,
          actorId: actors.extra.id,
          addedAt: new Date('2025-12-01T00:00:00.000Z'),
          removedAt: new Date('2030-12-01T00:00:00.000Z')
        })

        expect(updated?.periods).toHaveLength(3)
        expect(updated?.periods[0].addedAt).toEqual(
          Date.parse('2025-12-01T00:00:00.000Z')
        )
        expect(updated?.periods[2].removedAt).toEqual(
          Date.parse('2030-12-01T00:00:00.000Z')
        )
        // Untouched, both ends.
        expect(updated?.periods[1].addedAt).toEqual(middleBefore.addedAt)
        expect(updated?.periods[1].removedAt).toEqual(middleBefore.removedAt)
      })

      // `removedAt: null` remains the precise way to say "this retirement never
      // happened" — it reopens the LAST period rather than opening another one,
      // which is exactly the difference from a refit.
      it('reopens the last period rather than opening a new one when the removal date is cleared', async () => {
        const bike = await database.createFitnessGear({
          actorId: actors.pollAuthor.id,
          kind: 'bike',
          name: 'Component reopen bike'
        })
        const component = await database.createFitnessGearComponent({
          gearId: bike.id,
          actorId: actors.pollAuthor.id,
          componentType: 'Chain',
          addedAt: new Date('2026-01-01T00:00:00.000Z'),
          removedAt: new Date('2026-02-01T00:00:00.000Z')
        })

        const updated = await database.updateFitnessGearComponent({
          id: component!.id,
          gearId: bike.id,
          actorId: actors.pollAuthor.id,
          removedAt: null
        })

        expect(updated?.periods).toHaveLength(1)
        expect(updated?.periods[0].addedAt).toEqual(
          Date.parse('2026-01-01T00:00:00.000Z')
        )
        expect(updated?.removedAt).toBeUndefined()
      })

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
  })
})
