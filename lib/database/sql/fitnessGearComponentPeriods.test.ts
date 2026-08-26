import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'

/**
 * The two properties of the component rollup that need a state the public
 * `Database` interface cannot construct, so they take the raw Knex instance.
 *
 * Built on `getTestDatabaseWithInstance` rather than the SQLite-only
 * `getTestSQLDatabaseWithInstance`, because both are about how the join reads
 * across backends — a suite on the SQLite-only helper reports a clean run under
 * the pg environment variables having never opened a PostgreSQL connection.
 */
describe('fitness gear component periods', () => {
  const { database, instance, prepare } = getTestDatabaseWithInstance(true)

  const actorId = 'https://llun.test/users/periods'

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await database.createActor({
      actorId,
      username: 'periods',
      domain: 'llun.test',
      followersUrl: `${actorId}/followers`,
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: 'https://llun.test/inbox',
      publicKey: 'public',
      privateKey: 'private',
      createdAt: Date.now()
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  const createBikeWithRide = async (
    name: string,
    {
      distanceMeters,
      activityStartTime
    }: {
      distanceMeters: number
      activityStartTime: Date
    }
  ) => {
    const gear = await database.createFitnessGear({
      actorId,
      kind: 'bike',
      name
    })
    const file = await database.createFitnessFile({
      actorId,
      path: `fitness/${name}.fit`,
      fileName: `${name}.fit`,
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1024
    })
    await database.updateFitnessFileActivityData(file!.id, {
      activityType: 'cycling',
      activityStartTime,
      totalDistanceMeters: distanceMeters
    })
    await database.updateFitnessFileProcessingStatus(file!.id, 'completed')
    await database.assignFitnessFileGearIfUnset({
      fitnessFileId: file!.id,
      actorId,
      gearId: gear.id
    })
    return gear
  }

  // Nothing in `lib/database/sql/fitnessGear.ts` can produce a component with
  // no period — the pair is inserted in one transaction. The guard matters
  // anyway, because without `p.id IS NOT NULL` in the join BOTH window tests
  // read as TRUE against the missing row's NULLs, and the component silently
  // claims every activity ever ridden on the gear.
  it('gives a component with no period rows nothing, rather than everything', async () => {
    const gear = await createBikeWithRide('periodless', {
      distanceMeters: 15_000,
      activityStartTime: new Date('2026-04-15T08:00:00.000Z')
    })
    const component = await database.createFitnessGearComponent({
      gearId: gear.id,
      actorId,
      componentType: 'Frame'
    })

    await instance('fitness_gear_component_periods')
      .where('componentId', component!.id)
      .delete()

    const rollups = await database.getFitnessGearComponentDistanceRollups({
      actorId,
      gearIds: [gear.id]
    })
    expect(rollups[component!.id]).toEqual({
      distanceMeters: 0,
      activityCount: 0
    })
  })

  // Periods cannot overlap by construction, but the join fans out over them, so
  // pin what happens if one ever did: an activity inside two periods would be
  // summed twice, and a component would report double the distance it covered.
  it('would count an activity once per overlapping period, so overlap must stay impossible', async () => {
    const gear = await createBikeWithRide('overlapping', {
      distanceMeters: 25_000,
      activityStartTime: new Date('2026-05-15T08:00:00.000Z')
    })
    const component = await database.createFitnessGearComponent({
      gearId: gear.id,
      actorId,
      componentType: 'Chain',
      addedAt: new Date('2026-05-01T00:00:00.000Z'),
      removedAt: new Date('2026-06-01T00:00:00.000Z')
    })

    const clean = await database.getFitnessGearComponentDistanceRollups({
      actorId,
      gearIds: [gear.id]
    })
    expect(clean[component!.id]).toEqual({
      distanceMeters: 25_000,
      activityCount: 1
    })

    // Only reachable by writing the row directly: `refit` refuses while a
    // period is open, and an edit can only move the outermost bounds.
    await instance('fitness_gear_component_periods').insert({
      id: 'overlapping-period',
      componentId: component!.id,
      installSequence: 2,
      addedAt: new Date('2026-05-01T00:00:00.000Z'),
      removedAt: new Date('2026-06-01T00:00:00.000Z'),
      createdAt: new Date(),
      updatedAt: new Date()
    })

    const doubled = await database.getFitnessGearComponentDistanceRollups({
      actorId,
      gearIds: [gear.id]
    })
    expect(doubled[component!.id]).toEqual({
      distanceMeters: 50_000,
      activityCount: 2
    })
  })
})
