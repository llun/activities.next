import { type Insertable, sql } from 'kysely'

import type {
  FitnessFiles,
  FitnessGearComponentPeriods,
  FitnessGearComponents,
  FitnessGears
} from '@/lib/database/kysely/db'
import { createSearchActor } from '@/lib/database/sql/searchTestHelpers'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

const DOMAIN = 'gearq.test'

// Every `where`, `orderBy`, `limit` and `offset` in the fitness gear queries,
// each pinned with a neighbouring row the query must not touch (another
// actor's, another gear's, a deleted, retired, unfinished or non-primary one),
// plus the transactions of createFitnessGear, updateFitnessGear,
// deleteFitnessGear, setFitnessFileGear, createFitnessGearComponent,
// updateFitnessGearComponent and refitFitnessGearComponent rolling back as a
// whole when their last write fails. Rows are written straight into the tables
// where a test needs a timestamp, an id order or a shape no method produces.
// Runs on PostgreSQL in CI.

const testDb = createTestDatabase()
const { database } = testDb
const db = () => testDb.db

beforeAll(async () => {
  await testDb.prepare()
  await database.migrate()
})

afterAll(async () => {
  await database.destroy()
})

let actorCount = 0
const newActor = async () => {
  actorCount += 1
  const username = `gearq${actorCount}`
  const id = `https://${DOMAIN}/users/${username}`
  await createSearchActor(database, { id, username, domain: DOMAIN })
  return id
}

let idCount = 0
const nextId = (prefix: string) => {
  idCount += 1
  return `${prefix}-${String(idCount).padStart(5, '0')}`
}

const at = (iso: string) => new Date(`${iso}T08:00:00.000Z`)
const ms = (iso: string) => at(iso).getTime()

const seedGear = async (
  actorId: string,
  values: Partial<Insertable<FitnessGears>> = {}
) => {
  const id = values.id ?? nextId('gear')
  await db()
    .insertInto('fitness_gears')
    .values({
      kind: 'bike',
      name: id,
      createdAt: at('2026-01-01'),
      updatedAt: at('2026-01-01'),
      ...values,
      id,
      actorId
    })
    .execute()
  return id
}

const seedFile = async (
  actorId: string,
  values: Partial<Insertable<FitnessFiles>> = {}
) => {
  const id = values.id ?? nextId('file')
  await db()
    .insertInto('fitness_files')
    .values({
      path: `fitness/${id}.fit`,
      fileName: `${id}.fit`,
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1,
      processingStatus: 'completed',
      isPrimary: true,
      createdAt: at('2026-01-01'),
      updatedAt: at('2026-01-01'),
      ...values,
      id,
      actorId
    })
    .execute()
  return id
}

const seedComponent = async (
  gearId: string,
  values: Partial<Insertable<FitnessGearComponents>> = {},
  // The single period most components have; null leaves the component without
  // one, a shape nothing in the domain produces.
  period: Partial<Insertable<FitnessGearComponentPeriods>> | null = {}
) => {
  const id = values.id ?? nextId('component')
  await db()
    .insertInto('fitness_gear_components')
    .values({
      componentType: 'Chain',
      createdAt: at('2026-01-01'),
      updatedAt: at('2026-01-01'),
      ...values,
      id,
      gearId
    })
    .execute()
  if (period) await seedPeriod(id, period)
  return id
}

const seedPeriod = async (
  componentId: string,
  values: Partial<Insertable<FitnessGearComponentPeriods>> = {}
) => {
  const id = values.id ?? nextId('period')
  await db()
    .insertInto('fitness_gear_component_periods')
    .values({
      installSequence: 1,
      createdAt: at('2026-01-01'),
      updatedAt: at('2026-01-01'),
      ...values,
      id,
      componentId
    })
    .execute()
  return id
}

const gearRow = (id: string) =>
  db()
    .selectFrom('fitness_gears')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow()

const fileRow = (id: string) =>
  db()
    .selectFrom('fitness_files')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow()

const componentRow = (id: string) =>
  db()
    .selectFrom('fitness_gear_components')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow()

const periodRows = (componentId: string) =>
  db()
    .selectFrom('fitness_gear_component_periods')
    .selectAll()
    .where('componentId', '=', componentId)
    .orderBy('installSequence')
    .execute()

const TABLES = [
  'fitness_gears',
  'fitness_gear_components',
  'fitness_gear_component_periods',
  'fitness_files'
] as const

const dumpTables = async () => {
  const dump: Record<string, unknown[]> = {}
  for (const table of TABLES) {
    dump[table] = await db()
      .selectFrom(table)
      .selectAll()
      .orderBy('id')
      .execute()
  }
  return dump
}

// Makes the next write on `table` matching `condition` (SQL over `new` or
// `old`, valid on both backends) fail. With `unique`, the failure looks like a
// unique violation (PostgreSQL code 23505, SQLite's UNIQUE message). Returns
// the function that removes the trigger again.
let triggerCount = 0
const failWrite = async (
  table: (typeof TABLES)[number],
  event: 'insert' | 'update',
  condition: string,
  { unique = false } = {}
) => {
  triggerCount += 1
  const name = `gear_queries_fail_${triggerCount}`
  if (testDb.backend === 'pg') {
    const raise = unique
      ? `raise exception 'forced unique' using errcode = 'unique_violation'`
      : `raise exception 'forced failure'`
    await sql
      .raw(
        `create or replace function ${name}() returns trigger language plpgsql as $$ begin ${raise}; end $$`
      )
      .execute(db())
    await sql
      .raw(
        `create trigger ${name} before ${event} on "${table}" for each row when (${condition}) execute function ${name}()`
      )
      .execute(db())
    return async () => {
      await sql.raw(`drop trigger ${name} on "${table}"`).execute(db())
      await sql.raw(`drop function ${name}()`).execute(db())
    }
  }
  const message = unique ? 'UNIQUE constraint failed: forced' : 'forced failure'
  await sql
    .raw(
      `create trigger ${name} before ${event} on "${table}" when ${condition} begin select raise(abort, '${message}'); end`
    )
    .execute(db())
  return async () => {
    await sql.raw(`drop trigger ${name}`).execute(db())
  }
}

// Runs `action` expecting it to fail on the forced write, then checks every
// table the domain writes is exactly as it was.
const expectRolledBack = async (
  drop: () => Promise<void>,
  action: () => Promise<unknown>
) => {
  const before = await dumpTables()
  try {
    await expect(action()).rejects.toThrow()
  } finally {
    await drop()
  }
  expect(await dumpTables()).toEqual(before)
}

describe('gear reads', () => {
  it('getFitnessGear reads only the actor’s own, non-deleted gear', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const gearId = await seedGear(actorId, { name: 'Mine' })
    const deletedId = await seedGear(actorId, { deletedAt: at('2026-02-01') })

    expect(await database.getFitnessGear({ id: gearId, actorId })).toEqual(
      expect.objectContaining({ id: gearId, name: 'Mine', actorId })
    )
    expect(
      await database.getFitnessGear({ id: gearId, actorId: otherActorId })
    ).toBeNull()
    expect(await database.getFitnessGear({ id: deletedId, actorId })).toBeNull()
  })

  it('maps every column, epoch-0 timestamps and unparseable default sports', async () => {
    const actorId = await newActor()
    const gearId = await seedGear(actorId, {
      kind: 'device',
      name: 'Head unit',
      brand: 'Wahoo',
      model: 'Elemnt',
      bikeType: null,
      weightKilograms: 0.25,
      defaultSports: 'not json',
      alertDistanceMeters: 1000,
      lastAlertedDistanceMeters: 500,
      notes: 'notes',
      deviceKey: 'wahoo:elemnt',
      productUrl: 'https://example.test/elemnt',
      retiredAt: new Date(0),
      createdAt: at('2026-01-02'),
      updatedAt: at('2026-01-03')
    })

    expect(await database.getFitnessGear({ id: gearId, actorId })).toEqual({
      id: gearId,
      actorId,
      kind: 'device',
      name: 'Head unit',
      brand: 'Wahoo',
      model: 'Elemnt',
      bikeType: undefined,
      weightKilograms: 0.25,
      defaultSports: [],
      alertDistanceMeters: 1000,
      lastAlertedDistanceMeters: 500,
      notes: 'notes',
      deviceKey: 'wahoo:elemnt',
      productUrl: 'https://example.test/elemnt',
      retiredAt: 0,
      createdAt: ms('2026-01-02'),
      updatedAt: ms('2026-01-03'),
      deletedAt: undefined
    })
  })

  it('getFitnessGearsByActor lists the actor’s gear by createdAt, then id', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    // Written out of order, so neither the insert order nor the id order is
    // the answer on its own.
    const newest = await seedGear(actorId, {
      id: `${actorId}-gear-b`,
      createdAt: at('2026-03-01')
    })
    const tieHigh = await seedGear(actorId, {
      id: `${actorId}-gear-c`,
      createdAt: at('2026-02-01')
    })
    const tieLow = await seedGear(actorId, {
      id: `${actorId}-gear-a`,
      createdAt: at('2026-02-01')
    })
    await seedGear(actorId, { deletedAt: at('2026-02-02') })
    await seedGear(otherActorId)

    const gears = await database.getFitnessGearsByActor({ actorId })
    expect(gears.map((gear) => gear.id)).toEqual([tieLow, tieHigh, newest])
  })

  it('getFitnessGearNamesByIds names the requested, non-deleted gear only', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const first = await seedGear(actorId, { name: 'First' })
    const second = await seedGear(otherActorId, { name: 'Second' })
    const deleted = await seedGear(actorId, {
      name: 'Deleted',
      deletedAt: at('2026-02-01')
    })
    await seedGear(actorId, { name: 'Not asked for' })

    expect(
      await database.getFitnessGearNamesByIds({
        ids: [first, second, deleted, first, 'missing']
      })
    ).toEqual({ [first]: 'First', [second]: 'Second' })
    expect(await database.getFitnessGearNamesByIds({ ids: [] })).toEqual({})
  })

  it('findFitnessGearByDeviceKey matches the actor and key of a live device', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const live = await seedGear(actorId, {
      kind: 'device',
      deviceKey: 'garmin:edge'
    })
    await seedGear(actorId, {
      kind: 'device',
      deviceKey: 'garmin:other'
    })
    await seedGear(otherActorId, {
      kind: 'device',
      deviceKey: 'garmin:deleted-elsewhere'
    })
    // A deleted device whose key was not released (written straight in).
    await seedGear(actorId, {
      kind: 'device',
      deviceKey: 'garmin:deleted',
      deletedAt: at('2026-02-01')
    })

    expect(
      (
        await database.findFitnessGearByDeviceKey({
          actorId,
          deviceKey: 'garmin:edge'
        })
      )?.id
    ).toBe(live)
    expect(
      await database.findFitnessGearByDeviceKey({
        actorId,
        deviceKey: 'garmin:deleted-elsewhere'
      })
    ).toBeNull()
    expect(
      await database.findFitnessGearByDeviceKey({
        actorId: otherActorId,
        deviceKey: 'garmin:edge'
      })
    ).toBeNull()
    expect(
      await database.findFitnessGearByDeviceKey({
        actorId,
        deviceKey: 'garmin:deleted'
      })
    ).toBeNull()
  })

  it('findFitnessGearByDefaultSport picks the oldest active holder', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    // Two holders of one sport is a state the domain does not write, so the
    // order is what decides between them.
    await seedGear(actorId, {
      id: `${actorId}-gear-c`,
      defaultSports: JSON.stringify(['ride']),
      createdAt: at('2026-03-01')
    })
    await seedGear(actorId, {
      id: `${actorId}-gear-b`,
      defaultSports: JSON.stringify(['run', 'ride']),
      createdAt: at('2026-02-01')
    })
    const winner = await seedGear(actorId, {
      id: `${actorId}-gear-a`,
      defaultSports: JSON.stringify(['ride']),
      createdAt: at('2026-02-01')
    })
    // Older still, but out of the running.
    await seedGear(actorId, {
      defaultSports: JSON.stringify(['ride', 'swim']),
      retiredAt: at('2026-01-15'),
      createdAt: at('2026-01-01')
    })
    await seedGear(actorId, {
      defaultSports: JSON.stringify(['ride', 'walk']),
      deletedAt: at('2026-01-15'),
      createdAt: at('2026-01-01')
    })
    await seedGear(otherActorId, {
      defaultSports: JSON.stringify(['ride', 'hike']),
      createdAt: at('2026-01-01')
    })

    expect(
      (
        await database.findFitnessGearByDefaultSport({
          actorId,
          sportKey: 'ride'
        })
      )?.id
    ).toBe(winner)
    expect(
      await database.findFitnessGearByDefaultSport({
        actorId,
        sportKey: 'swim'
      })
    ).toBeNull()
    expect(
      await database.findFitnessGearByDefaultSport({
        actorId,
        sportKey: 'walk'
      })
    ).toBeNull()
    expect(
      await database.findFitnessGearByDefaultSport({
        actorId,
        sportKey: 'hike'
      })
    ).toBeNull()
  })

  it('findFitnessGearByName matches case-insensitively, oldest first', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    await seedGear(actorId, {
      id: `${actorId}-gear-c`,
      name: 'Tarmac',
      createdAt: at('2026-03-01')
    })
    await seedGear(actorId, {
      id: `${actorId}-gear-b`,
      name: ' TARMAC ',
      createdAt: at('2026-02-01')
    })
    const winner = await seedGear(actorId, {
      id: `${actorId}-gear-a`,
      name: 'tarmac',
      createdAt: at('2026-02-01')
    })
    await seedGear(actorId, {
      name: 'Deleted',
      deletedAt: at('2026-01-15'),
      createdAt: at('2026-01-01')
    })
    await seedGear(otherActorId, { name: 'Elsewhere' })

    expect(
      (await database.findFitnessGearByName({ actorId, name: '  Tarmac' }))?.id
    ).toBe(winner)
    expect(
      await database.findFitnessGearByName({ actorId, name: 'deleted' })
    ).toBeNull()
    expect(
      await database.findFitnessGearByName({ actorId, name: 'elsewhere' })
    ).toBeNull()
    expect(await database.findFitnessGearByName({ actorId, name: '  ' })).toBe(
      null
    )
  })
})

describe('gear writes', () => {
  it('createFitnessGear takes its sports from the actor’s other gear only', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const holder = await seedGear(actorId, {
      defaultSports: JSON.stringify(['ride', 'run'])
    })
    const retiredHolder = await seedGear(actorId, {
      defaultSports: JSON.stringify(['gravel_ride']),
      retiredAt: at('2026-02-01')
    })
    const deletedHolder = await seedGear(actorId, {
      defaultSports: JSON.stringify(['ride']),
      deletedAt: at('2026-02-01')
    })
    const untouched = await seedGear(actorId, {
      defaultSports: JSON.stringify(['swim'])
    })
    const otherHolder = await seedGear(otherActorId, {
      defaultSports: JSON.stringify(['ride'])
    })

    const created = await database.createFitnessGear({
      actorId,
      kind: 'bike',
      name: 'New bike',
      defaultSports: ['ride', 'gravel_ride'],
      weightKilograms: 8.5
    })
    expect(created).toEqual(
      expect.objectContaining({
        actorId,
        kind: 'bike',
        name: 'New bike',
        defaultSports: ['ride', 'gravel_ride'],
        weightKilograms: 8.5,
        retiredAt: undefined,
        deletedAt: undefined
      })
    )
    expect(created.createdAt).toBe(created.updatedAt)
    expect(await database.getFitnessGear({ id: created.id, actorId })).toEqual(
      created
    )

    expect((await gearRow(holder)).defaultSports).toBe(JSON.stringify(['run']))
    expect((await gearRow(retiredHolder)).defaultSports).toBe('[]')
    expect((await gearRow(deletedHolder)).defaultSports).toBe(
      JSON.stringify(['ride'])
    )
    expect((await gearRow(untouched)).defaultSports).toBe(
      JSON.stringify(['swim'])
    )
    expect((await gearRow(untouched)).updatedAt).toBe(ms('2026-01-01'))
    expect((await gearRow(otherHolder)).defaultSports).toBe(
      JSON.stringify(['ride'])
    )
  })

  it('createFitnessGear keeps nothing when the gear insert fails', async () => {
    const actorId = await newActor()
    await seedGear(actorId, { defaultSports: JSON.stringify(['ride']) })
    const drop = await failWrite(
      'fitness_gears',
      'insert',
      `new."name" = 'Doomed bike'`
    )
    await expectRolledBack(drop, () =>
      database.createFitnessGear({
        actorId,
        kind: 'bike',
        name: 'Doomed bike',
        defaultSports: ['ride']
      })
    )
  })

  it('updateFitnessGear writes the actor’s gear only and takes sports from its other gear', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const gearId = await seedGear(actorId, {
      name: 'Before',
      defaultSports: JSON.stringify(['ride']),
      alertDistanceMeters: 1000,
      lastAlertedDistanceMeters: 1000,
      deviceKey: 'kept:key'
    })
    const holder = await seedGear(actorId, {
      defaultSports: JSON.stringify(['run', 'walk'])
    })
    const neighbour = await seedGear(actorId, { name: 'Neighbour' })
    const otherHolder = await seedGear(otherActorId, {
      defaultSports: JSON.stringify(['run'])
    })

    const updated = await database.updateFitnessGear({
      id: gearId,
      actorId,
      name: 'After',
      brand: null,
      defaultSports: ['ride', 'run'],
      alertDistanceMeters: 2000
    })
    expect(updated).toEqual(
      expect.objectContaining({
        id: gearId,
        name: 'After',
        brand: undefined,
        defaultSports: ['ride', 'run'],
        alertDistanceMeters: 2000,
        // A changed threshold re-arms the reminder.
        lastAlertedDistanceMeters: undefined,
        deviceKey: 'kept:key'
      })
    )
    expect((await gearRow(holder)).defaultSports).toBe(JSON.stringify(['walk']))
    expect((await gearRow(neighbour)).name).toBe('Neighbour')
    expect((await gearRow(neighbour)).updatedAt).toBe(ms('2026-01-01'))
    expect((await gearRow(otherHolder)).defaultSports).toBe(
      JSON.stringify(['run'])
    )

    // The same threshold leaves a fired reminder alone.
    await database.setFitnessGearLastAlertedDistance({
      id: gearId,
      lastAlertedDistanceMeters: 2000
    })
    expect(
      (
        await database.updateFitnessGear({
          id: gearId,
          actorId,
          alertDistanceMeters: 2000
        })
      )?.lastAlertedDistanceMeters
    ).toBe(2000)

    // Another actor's or a deleted gear is not found, and not written.
    expect(
      await database.updateFitnessGear({
        id: gearId,
        actorId: otherActorId,
        name: 'Stolen'
      })
    ).toBeNull()
    const deleted = await seedGear(actorId, {
      name: 'Deleted',
      deletedAt: at('2026-02-01')
    })
    expect(
      await database.updateFitnessGear({
        id: deleted,
        actorId,
        name: 'Revived'
      })
    ).toBeNull()
    expect((await gearRow(gearId)).name).toBe('After')
    expect((await gearRow(deleted)).name).toBe('Deleted')
  })

  it('updateFitnessGear keeps nothing when the gear update fails', async () => {
    const actorId = await newActor()
    const gearId = await seedGear(actorId)
    await seedGear(actorId, { defaultSports: JSON.stringify(['ride']) })
    const drop = await failWrite(
      'fitness_gears',
      'update',
      `old."id" = '${gearId}'`
    )
    await expectRolledBack(drop, () =>
      database.updateFitnessGear({
        id: gearId,
        actorId,
        name: 'Doomed',
        defaultSports: ['ride']
      })
    )
  })

  it('setFitnessGearRetired writes only a real transition of the actor’s live gear', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const gearId = await seedGear(actorId, { lastAlertedDistanceMeters: 500 })
    const neighbour = await seedGear(actorId, {
      lastAlertedDistanceMeters: 500
    })

    const retired = await database.setFitnessGearRetired({
      id: gearId,
      actorId,
      retired: true
    })
    expect(retired?.retiredAt).toEqual(expect.any(Number))
    expect(retired?.lastAlertedDistanceMeters).toBeUndefined()
    expect((await gearRow(neighbour)).retiredAt).toBeNull()
    expect((await gearRow(neighbour)).lastAlertedDistanceMeters).toBe(500)

    // Retiring again moves nothing: not the date, not a fired alert.
    await database.setFitnessGearLastAlertedDistance({
      id: gearId,
      lastAlertedDistanceMeters: 700
    })
    const before = await gearRow(gearId)
    const again = await database.setFitnessGearRetired({
      id: gearId,
      actorId,
      retired: true
    })
    expect(again?.retiredAt).toBe(retired?.retiredAt)
    expect(await gearRow(gearId)).toEqual(before)

    // Unretiring live gear that is not retired is a no-op too.
    const active = await seedGear(actorId, { lastAlertedDistanceMeters: 300 })
    const activeBefore = await gearRow(active)
    expect(
      (
        await database.setFitnessGearRetired({
          id: active,
          actorId,
          retired: false
        })
      )?.retiredAt
    ).toBeUndefined()
    expect(await gearRow(active)).toEqual(activeBefore)

    // Unretiring a retired one clears the date.
    expect(
      (
        await database.setFitnessGearRetired({
          id: gearId,
          actorId,
          retired: false
        })
      )?.retiredAt
    ).toBeUndefined()
    expect((await gearRow(gearId)).retiredAt).toBeNull()

    // Another actor's and a deleted gear are neither returned nor written.
    expect(
      await database.setFitnessGearRetired({
        id: gearId,
        actorId: otherActorId,
        retired: true
      })
    ).toBeNull()
    expect((await gearRow(gearId)).retiredAt).toBeNull()
    const deleted = await seedGear(actorId, { deletedAt: at('2026-02-01') })
    expect(
      await database.setFitnessGearRetired({
        id: deleted,
        actorId,
        retired: true
      })
    ).toBeNull()
    expect((await gearRow(deleted)).retiredAt).toBeNull()
  })

  it('deleteFitnessGear soft-deletes the actor’s gear and detaches only its files', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const deviceId = await seedGear(actorId, {
      kind: 'device',
      deviceKey: 'garmin:to-delete'
    })
    const bikeId = await seedGear(actorId)
    const neighbour = await seedGear(actorId, {
      kind: 'device',
      deviceKey: 'garmin:neighbour'
    })
    const ridden = await seedFile(actorId, {
      gearId: bikeId,
      deviceGearId: deviceId
    })
    const otherFile = await seedFile(actorId, {
      gearId: neighbour,
      deviceGearId: neighbour
    })

    expect(
      await database.deleteFitnessGear({ id: deviceId, actorId: otherActorId })
    ).toBe(false)
    expect((await gearRow(deviceId)).deletedAt).toBeNull()

    expect(await database.deleteFitnessGear({ id: deviceId, actorId })).toBe(
      true
    )
    const deleted = await gearRow(deviceId)
    expect(deleted.deletedAt).toEqual(expect.any(Number))
    expect(deleted.deviceKey).toBeNull()
    expect(await fileRow(ridden)).toEqual(
      expect.objectContaining({ gearId: bikeId, deviceGearId: null })
    )

    expect(await database.deleteFitnessGear({ id: bikeId, actorId })).toBe(true)
    expect(await fileRow(ridden)).toEqual(
      expect.objectContaining({ gearId: null, deviceGearId: null })
    )

    // A second delete finds nothing and stamps nothing.
    expect(await database.deleteFitnessGear({ id: deviceId, actorId })).toBe(
      false
    )
    expect(await gearRow(deviceId)).toEqual(deleted)

    expect(await gearRow(neighbour)).toEqual(
      expect.objectContaining({
        deletedAt: null,
        deviceKey: 'garmin:neighbour'
      })
    )
    expect(await fileRow(otherFile)).toEqual(
      expect.objectContaining({
        gearId: neighbour,
        deviceGearId: neighbour,
        updatedAt: ms('2026-01-01')
      })
    )
  })

  it('deleteFitnessGear keeps nothing when the device detach fails', async () => {
    const actorId = await newActor()
    // Linked through both columns, so the delete runs all three writes and
    // only the last one fails.
    const gearId = await seedGear(actorId, {
      kind: 'device',
      deviceKey: 'garmin:doomed'
    })
    await seedFile(actorId, { gearId, deviceGearId: gearId })
    const drop = await failWrite(
      'fitness_files',
      'update',
      `old."deviceGearId" = '${gearId}' and new."deviceGearId" is null`
    )
    await expectRolledBack(drop, () =>
      database.deleteFitnessGear({ id: gearId, actorId })
    )
  })

  it('setFitnessGearLastAlertedDistance wins only below the threshold, on live gear', async () => {
    const actorId = await newActor()
    const gearId = await seedGear(actorId, { lastAlertedDistanceMeters: 5000 })
    const neighbour = await seedGear(actorId, {
      lastAlertedDistanceMeters: 100
    })
    const unset = await seedGear(actorId)
    const deleted = await seedGear(actorId, { deletedAt: at('2026-02-01') })

    expect(
      await database.setFitnessGearLastAlertedDistance({
        id: gearId,
        lastAlertedDistanceMeters: 5000,
        onlyIfBelowThresholdMeters: 5000
      })
    ).toBe(false)
    expect((await gearRow(gearId)).updatedAt).toBe(ms('2026-01-01'))
    expect(
      await database.setFitnessGearLastAlertedDistance({
        id: gearId,
        lastAlertedDistanceMeters: 6000,
        onlyIfBelowThresholdMeters: 6000
      })
    ).toBe(true)
    expect((await gearRow(gearId)).lastAlertedDistanceMeters).toBe(6000)
    expect(
      await database.setFitnessGearLastAlertedDistance({
        id: unset,
        lastAlertedDistanceMeters: 1000,
        onlyIfBelowThresholdMeters: 1000
      })
    ).toBe(true)
    // Without a threshold it always writes, a lower value included.
    expect(
      await database.setFitnessGearLastAlertedDistance({
        id: gearId,
        lastAlertedDistanceMeters: null
      })
    ).toBe(true)
    expect((await gearRow(gearId)).lastAlertedDistanceMeters).toBeNull()
    expect(
      await database.setFitnessGearLastAlertedDistance({
        id: deleted,
        lastAlertedDistanceMeters: 1
      })
    ).toBe(false)
    expect((await gearRow(deleted)).lastAlertedDistanceMeters).toBeNull()
    expect((await gearRow(neighbour)).lastAlertedDistanceMeters).toBe(100)
  })
})

describe('file gear assignment', () => {
  it('setFitnessFileGear assigns the actor’s live, non-device gear to the actor’s live file', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const bike = await seedGear(actorId)
    const retired = await seedGear(actorId, { retiredAt: at('2026-02-01') })
    const device = await seedGear(actorId, { kind: 'device' })
    const deletedGear = await seedGear(actorId, {
      deletedAt: at('2026-02-01')
    })
    const otherBike = await seedGear(otherActorId)
    const file = await seedFile(actorId)
    const neighbour = await seedFile(actorId)
    const deletedFile = await seedFile(actorId, { deletedAt: at('2026-02-01') })

    expect(
      await database.setFitnessFileGear({
        fitnessFileId: file,
        actorId,
        gearId: bike
      })
    ).toEqual({ id: file, gearId: bike })
    expect((await fileRow(file)).gearId).toBe(bike)
    expect(await fileRow(neighbour)).toEqual(
      expect.objectContaining({ gearId: null, updatedAt: ms('2026-01-01') })
    )

    for (const gearId of [device, deletedGear, otherBike]) {
      expect(
        await database.setFitnessFileGear({
          fitnessFileId: file,
          actorId,
          gearId
        })
      ).toBeNull()
    }
    expect((await fileRow(file)).gearId).toBe(bike)

    expect(
      await database.setFitnessFileGear({
        fitnessFileId: file,
        actorId,
        gearId: retired
      })
    ).toEqual({ id: file, gearId: retired })
    expect(
      await database.setFitnessFileGear({
        fitnessFileId: file,
        actorId,
        gearId: null
      })
    ).toEqual({ id: file, gearId: null })
    expect((await fileRow(file)).gearId).toBeNull()

    expect(
      await database.setFitnessFileGear({
        fitnessFileId: file,
        actorId: otherActorId,
        gearId: otherBike
      })
    ).toBeNull()
    expect(
      await database.setFitnessFileGear({
        fitnessFileId: deletedFile,
        actorId,
        gearId: bike
      })
    ).toBeNull()
    expect((await fileRow(file)).gearId).toBeNull()
    expect((await fileRow(deletedFile)).gearId).toBeNull()
  })

  it('setFitnessFileGear keeps nothing when its write fails', async () => {
    const actorId = await newActor()
    const bike = await seedGear(actorId)
    const file = await seedFile(actorId)
    const drop = await failWrite(
      'fitness_files',
      'update',
      `old."id" = '${file}'`
    )
    await expectRolledBack(drop, () =>
      database.setFitnessFileGear({
        fitnessFileId: file,
        actorId,
        gearId: bike
      })
    )
  })

  it('assignFitnessFileGearIfUnset only fills an empty slot with the actor’s live, non-device gear', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const bike = await seedGear(actorId)
    const retired = await seedGear(actorId, { retiredAt: at('2026-02-01') })
    const device = await seedGear(actorId, { kind: 'device' })
    const deletedGear = await seedGear(actorId, {
      deletedAt: at('2026-02-01')
    })
    const otherBike = await seedGear(otherActorId)
    const file = await seedFile(actorId)
    const neighbour = await seedFile(actorId)
    const otherFile = await seedFile(otherActorId)
    const deletedFile = await seedFile(actorId, { deletedAt: at('2026-02-01') })

    for (const gearId of [device, deletedGear, otherBike]) {
      expect(
        await database.assignFitnessFileGearIfUnset({
          fitnessFileId: file,
          actorId,
          gearId
        })
      ).toBe(false)
    }
    expect(
      await database.assignFitnessFileGearIfUnset({
        fitnessFileId: otherFile,
        actorId,
        gearId: bike
      })
    ).toBe(false)
    expect(
      await database.assignFitnessFileGearIfUnset({
        fitnessFileId: deletedFile,
        actorId,
        gearId: bike
      })
    ).toBe(false)
    expect(
      await database.assignFitnessFileGearIfUnset({
        fitnessFileId: file,
        actorId,
        gearId: retired
      })
    ).toBe(true)
    // Already set: a re-run must not move it.
    expect(
      await database.assignFitnessFileGearIfUnset({
        fitnessFileId: file,
        actorId,
        gearId: bike
      })
    ).toBe(false)

    expect((await fileRow(file)).gearId).toBe(retired)
    expect((await fileRow(neighbour)).gearId).toBeNull()
    expect((await fileRow(otherFile)).gearId).toBeNull()
    expect((await fileRow(deletedFile)).gearId).toBeNull()
  })
})

describe('gear rollups', () => {
  it('getFitnessGearDistanceRollups sums the actor’s countable activities per requested gear', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const first = await seedGear(actorId)
    const second = await seedGear(actorId)
    const notAsked = await seedGear(actorId)
    for (const [values, owner] of [
      [{ gearId: first, totalDistanceMeters: 1000 }, actorId],
      [{ gearId: first, totalDistanceMeters: 2000 }, actorId],
      [
        {
          gearId: first,
          totalDistanceMeters: 4000,
          processingStatus: 'pending'
        },
        actorId
      ],
      [{ gearId: first, totalDistanceMeters: 8000, isPrimary: false }, actorId],
      [
        {
          gearId: first,
          totalDistanceMeters: 16000,
          deletedAt: at('2026-02-01')
        },
        actorId
      ],
      [{ gearId: first, totalDistanceMeters: 32000 }, otherActorId],
      [{ gearId: second, totalDistanceMeters: 64000 }, actorId],
      [{ gearId: second, totalDistanceMeters: null }, actorId],
      [{ gearId: notAsked, totalDistanceMeters: 128000 }, actorId]
    ] as const) {
      await seedFile(owner, values)
    }

    expect(
      await database.getFitnessGearDistanceRollups({
        actorId,
        gearIds: [first, second, first, 'missing']
      })
    ).toEqual({
      [first]: { distanceMeters: 3000, activityCount: 2 },
      [second]: { distanceMeters: 64000, activityCount: 2 },
      missing: { distanceMeters: 0, activityCount: 0 }
    })
    expect(
      await database.getFitnessGearDistanceRollups({ actorId, gearIds: [] })
    ).toEqual({})
  })

  it('getFitnessGearDeviceRollups counts one file per ride per device and the first start', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const device = await seedGear(actorId, { kind: 'device' })
    const idle = await seedGear(actorId, { kind: 'device' })
    const notAsked = await seedGear(actorId, { kind: 'device' })
    for (const [values, owner] of [
      // A secondary file with no post still counts for its device.
      [
        {
          deviceGearId: device,
          isPrimary: false,
          activityStartTime: at('2026-03-01')
        },
        actorId
      ],
      [{ deviceGearId: device, activityStartTime: at('2026-02-01') }, actorId],
      [{ deviceGearId: device, activityStartTime: null }, actorId],
      [
        {
          deviceGearId: device,
          activityStartTime: at('2026-01-01'),
          processingStatus: 'failed'
        },
        actorId
      ],
      [
        {
          deviceGearId: device,
          activityStartTime: at('2026-01-02'),
          deletedAt: at('2026-04-01')
        },
        actorId
      ],
      [
        { deviceGearId: device, activityStartTime: at('2026-01-03') },
        otherActorId
      ],
      [{ gearId: device, activityStartTime: at('2026-01-04') }, actorId],
      [{ deviceGearId: notAsked, activityStartTime: at('2026-01-05') }, actorId]
    ] as const) {
      await seedFile(owner, values)
    }

    expect(
      await database.getFitnessGearDeviceRollups({
        actorId,
        gearIds: [device, idle, device]
      })
    ).toEqual({
      [device]: { activityCount: 3, firstUsedAt: ms('2026-02-01') },
      [idle]: { activityCount: 0, firstUsedAt: null }
    })
    expect(
      await database.getFitnessGearDeviceRollups({ actorId, gearIds: [] })
    ).toEqual({})
  })

  it('getFitnessGearDeviceRollups reads null when every linked activity is timestamp-less', async () => {
    const actorId = await newActor()
    const device = await seedGear(actorId, { kind: 'device' })
    await seedFile(actorId, { deviceGearId: device, activityStartTime: null })
    expect(
      await database.getFitnessGearDeviceRollups({ actorId, gearIds: [device] })
    ).toEqual({ [device]: { activityCount: 1, firstUsedAt: null } })
  })

  // MIN hands back the stored value as is on SQLite, where a legacy row can
  // hold its start as SQLite timestamp text. PostgreSQL stores a timestamp.
  it.skipIf(testDb.backend === 'pg')(
    'getFitnessGearDeviceRollups reads a start stored as SQLite timestamp text',
    async () => {
      const actorId = await newActor()
      const device = await seedGear(actorId, { kind: 'device' })
      const fileId = await seedFile(actorId, { deviceGearId: device })
      await sql`update "fitness_files" set "activityStartTime" = '2026-03-01 08:00:00' where "id" = ${fileId}`.execute(
        db()
      )
      expect(
        await database.getFitnessGearDeviceRollups({
          actorId,
          gearIds: [device]
        })
      ).toEqual({
        [device]: {
          activityCount: 1,
          firstUsedAt: Date.parse('2026-03-01T08:00:00.000Z')
        }
      })
    }
  )
})

describe('getFitnessGearActivities', () => {
  const seedHistory = async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const bike = await seedGear(actorId)
    const otherBike = await seedGear(actorId)
    const id = (key: string) => `${bike}-${key}`
    const file = (key: string, values: Partial<Insertable<FitnessFiles>>) =>
      seedFile(actorId, { id: id(key), gearId: bike, ...values })

    // Written in an order that matches none of the sort keys.
    await file('none', { activityStartTime: null })
    await file('early', { activityStartTime: at('2026-01-01') })
    await file('tie-2', {
      activityStartTime: at('2026-03-01'),
      createdAt: at('2026-03-01')
    })
    await file('same-p', {
      activityStartTime: at('2026-04-01'),
      createdAt: at('2026-04-01')
    })
    await file('late', { activityStartTime: at('2026-05-01') })
    await file('tie-1', {
      activityStartTime: at('2026-03-01'),
      createdAt: at('2026-03-02')
    })
    await file('same-q', {
      activityStartTime: at('2026-04-01'),
      createdAt: at('2026-04-01')
    })
    // None of these is on the bike's page.
    await file('pending', {
      activityStartTime: at('2026-06-01'),
      processingStatus: 'pending'
    })
    await file('secondary', {
      activityStartTime: at('2026-06-01'),
      isPrimary: false
    })
    await file('deleted', {
      activityStartTime: at('2026-06-01'),
      deletedAt: at('2026-06-02')
    })
    await seedFile(actorId, {
      gearId: otherBike,
      activityStartTime: at('2026-06-01')
    })
    await seedFile(otherActorId, {
      gearId: bike,
      activityStartTime: at('2026-06-01')
    })
    await seedFile(actorId, {
      deviceGearId: bike,
      activityStartTime: at('2026-06-01')
    })
    return {
      actorId,
      bike,
      expected: [
        'late',
        'same-q',
        'same-p',
        'tie-1',
        'tie-2',
        'early',
        'none'
      ].map(id)
    }
  }

  it('lists the gear’s countable activities newest first, timestamp-less last', async () => {
    const { actorId, bike, expected } = await seedHistory()
    const rows = await database.getFitnessGearActivities({
      actorId,
      gearId: bike,
      kind: 'bike',
      limit: 20
    })
    expect(rows.map((row) => row.id)).toEqual(expected)
    expect(rows.every((row) => row.statusId === null)).toBe(true)
  })

  it('pages with limit and offset', async () => {
    const { actorId, bike, expected } = await seedHistory()
    const page = (offset?: number) =>
      database
        .getFitnessGearActivities({
          actorId,
          gearId: bike,
          kind: 'shoes',
          limit: 3,
          ...(offset === undefined ? {} : { offset })
        })
        .then((rows) => rows.map((row) => row.id))
    expect(await page()).toEqual(expected.slice(0, 3))
    expect(await page(3)).toEqual(expected.slice(3, 6))
    expect(await page(6)).toEqual(expected.slice(6))
  })

  it('lists a device’s activities through its own column, one per ride', async () => {
    const actorId = await newActor()
    const device = await seedGear(actorId, { kind: 'device' })
    const statusId = `${actorId}/statuses/ride`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId,
      text: 'ride',
      to: [],
      cc: []
    })
    const id = (key: string) => `${device}-${key}`
    await seedFile(actorId, {
      id: id('secondary'),
      deviceGearId: device,
      isPrimary: false,
      activityStartTime: at('2026-02-01')
    })
    await seedFile(actorId, {
      id: id('posted'),
      deviceGearId: device,
      statusId,
      activityStartTime: at('2026-03-01')
    })
    // A second file of the same ride from the same device does not count.
    await seedFile(actorId, {
      id: id('posted-copy'),
      deviceGearId: device,
      statusId,
      isPrimary: false,
      activityStartTime: at('2026-03-01')
    })
    await seedFile(actorId, {
      id: id('ridden-on'),
      gearId: device,
      activityStartTime: at('2026-04-01')
    })

    expect(
      await database.getFitnessGearActivities({
        actorId,
        gearId: device,
        kind: 'device',
        limit: 10
      })
    ).toEqual([
      { id: id('posted'), statusId },
      { id: id('secondary'), statusId: null }
    ])
  })
})

describe('component reads', () => {
  it('getFitnessGearComponents lists the live components of the actor’s live gear', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const gearId = await seedGear(actorId)
    const otherGear = await seedGear(actorId)
    const deletedGear = await seedGear(actorId, {
      deletedAt: at('2026-02-01')
    })
    // Installed ones oldest first whatever the insert order, then the removed
    // ones by when they came off, newest first.
    const newer = await seedComponent(gearId, {
      componentType: 'Newer',
      createdAt: at('2026-03-01')
    })
    const older = await seedComponent(gearId, {
      componentType: 'Older',
      createdAt: at('2026-02-01')
    })
    const removedLong = await seedComponent(
      gearId,
      { componentType: 'Removed long ago', createdAt: at('2026-01-01') },
      { removedAt: at('2026-02-01') }
    )
    const removedLately = await seedComponent(
      gearId,
      { componentType: 'Removed lately', createdAt: at('2026-01-02') },
      { removedAt: at('2026-04-01') }
    )
    await seedComponent(gearId, { deletedAt: at('2026-02-01') })
    await seedComponent(otherGear)
    await seedComponent(deletedGear)

    const components = await database.getFitnessGearComponents({
      gearId,
      actorId
    })
    expect(components.map((component) => component.id)).toEqual([
      older,
      newer,
      removedLately,
      removedLong
    ])
    expect(
      await database.getFitnessGearComponents({ gearId, actorId: otherActorId })
    ).toEqual([])
    expect(
      await database.getFitnessGearComponents({ gearId: deletedGear, actorId })
    ).toEqual([])
  })

  it('reads every period of a component in install order and derives its bounds', async () => {
    const actorId = await newActor()
    const gearId = await seedGear(actorId)
    const componentId = await seedComponent(
      gearId,
      {
        brand: 'Shimano',
        serviceDistanceMeters: 3000,
        lastAlertedDistanceMeters: 1500,
        productUrl: 'https://example.test/chain'
      },
      { installSequence: 1, addedAt: null, removedAt: at('2026-02-01') }
    )
    // Written out of sequence order.
    const third = await seedPeriod(componentId, {
      installSequence: 3,
      addedAt: at('2026-04-01'),
      removedAt: null
    })
    const second = await seedPeriod(componentId, {
      installSequence: 2,
      addedAt: at('2026-02-15'),
      removedAt: at('2026-03-01')
    })
    // Another component's periods stay out of it.
    await seedComponent(
      gearId,
      { createdAt: at('2026-02-01') },
      { installSequence: 1 }
    )

    const [component] = await database.getFitnessGearComponents({
      gearId,
      actorId
    })
    expect(component).toEqual(
      expect.objectContaining({
        id: componentId,
        brand: 'Shimano',
        model: undefined,
        serviceDistanceMeters: 3000,
        lastAlertedDistanceMeters: 1500,
        productUrl: 'https://example.test/chain',
        addedAt: undefined,
        removedAt: undefined,
        deletedAt: undefined
      })
    )
    expect(component.periods.map((period) => period.id)).toEqual([
      expect.any(String),
      second,
      third
    ])
    expect(component.periods.map((period) => period.installSequence)).toEqual([
      1, 2, 3
    ])
    expect(component.periods[1]).toEqual({
      id: second,
      componentId,
      installSequence: 2,
      addedAt: ms('2026-02-15'),
      removedAt: ms('2026-03-01'),
      createdAt: ms('2026-01-01'),
      updatedAt: ms('2026-01-01')
    })
  })
})

describe('component writes', () => {
  it('createFitnessGearComponent adds a component and its first period to the actor’s live gear', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const gearId = await seedGear(actorId)
    const deletedGear = await seedGear(actorId, {
      deletedAt: at('2026-02-01')
    })

    const component = await database.createFitnessGearComponent({
      gearId,
      actorId,
      componentType: 'Cassette',
      addedAt: at('2026-02-01'),
      removedAt: null,
      serviceDistanceMeters: 5000
    })
    expect(component).toEqual(
      expect.objectContaining({
        gearId,
        componentType: 'Cassette',
        addedAt: ms('2026-02-01'),
        removedAt: undefined,
        serviceDistanceMeters: 5000
      })
    )
    expect(component?.periods).toEqual([
      expect.objectContaining({
        componentId: component?.id,
        installSequence: 1,
        addedAt: ms('2026-02-01'),
        removedAt: undefined
      })
    ])
    expect(
      (await database.getFitnessGearComponents({ gearId, actorId }))[0]
    ).toEqual(component)

    expect(
      await database.createFitnessGearComponent({
        gearId,
        actorId: otherActorId,
        componentType: 'Stolen'
      })
    ).toBeNull()
    expect(
      await database.createFitnessGearComponent({
        gearId: deletedGear,
        actorId,
        componentType: 'Ghost'
      })
    ).toBeNull()
    const types = await db()
      .selectFrom('fitness_gear_components')
      .select('componentType')
      .where('gearId', 'in', [gearId, deletedGear])
      .execute()
    expect(types).toEqual([{ componentType: 'Cassette' }])
  })

  it('createFitnessGearComponent keeps nothing when the period insert fails', async () => {
    const actorId = await newActor()
    const gearId = await seedGear(actorId)
    const drop = await failWrite(
      'fitness_gear_component_periods',
      'insert',
      `new."addedAt" is not null`
    )
    await expectRolledBack(drop, () =>
      database.createFitnessGearComponent({
        gearId,
        actorId,
        componentType: 'Doomed',
        addedAt: at('2026-02-01')
      })
    )
  })

  it('updateFitnessGearComponent writes the owned component and moves its outer bounds', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const gearId = await seedGear(actorId)
    const componentId = await seedComponent(
      gearId,
      { serviceDistanceMeters: 1000, lastAlertedDistanceMeters: 1000 },
      {
        installSequence: 1,
        addedAt: at('2026-01-01'),
        removedAt: at('2026-02-01')
      }
    )
    // Written before the first period's row would sort it last by insert.
    await seedPeriod(componentId, {
      installSequence: 3,
      addedAt: at('2026-04-01'),
      removedAt: at('2026-05-01')
    })
    await seedPeriod(componentId, {
      installSequence: 2,
      addedAt: at('2026-03-01'),
      removedAt: at('2026-03-15')
    })
    // Its period sorts before every one of the component's, so reading the
    // periods of the wrong component would move it.
    const neighbour = await seedComponent(
      gearId,
      { componentType: 'Neighbour' },
      {
        installSequence: 0,
        addedAt: at('2026-01-01'),
        removedAt: at('2026-06-01')
      }
    )

    const updated = await database.updateFitnessGearComponent({
      id: componentId,
      gearId,
      actorId,
      componentType: 'Moved',
      serviceDistanceMeters: 2000,
      addedAt: at('2025-12-01'),
      removedAt: at('2026-06-01')
    })
    expect(updated).toEqual(
      expect.objectContaining({
        componentType: 'Moved',
        serviceDistanceMeters: 2000,
        lastAlertedDistanceMeters: undefined,
        addedAt: ms('2025-12-01'),
        removedAt: ms('2026-06-01')
      })
    )
    expect(
      (await periodRows(componentId)).map((period) => [
        period.installSequence,
        period.addedAt,
        period.removedAt
      ])
    ).toEqual([
      [1, ms('2025-12-01'), ms('2026-02-01')],
      [2, ms('2026-03-01'), ms('2026-03-15')],
      [3, ms('2026-04-01'), ms('2026-06-01')]
    ])
    expect(await componentRow(neighbour)).toEqual(
      expect.objectContaining({
        componentType: 'Neighbour',
        updatedAt: ms('2026-01-01')
      })
    )
    expect(
      (await periodRows(neighbour)).map((period) => [
        period.addedAt,
        period.removedAt,
        period.updatedAt
      ])
    ).toEqual([[ms('2026-01-01'), ms('2026-06-01'), ms('2026-01-01')]])

    // A bound that would invert its own period is refused, the other applied.
    await database.updateFitnessGearComponent({
      id: componentId,
      gearId,
      actorId,
      addedAt: at('2026-02-15')
    })
    await database.updateFitnessGearComponent({
      id: componentId,
      gearId,
      actorId,
      removedAt: at('2026-03-20')
    })
    expect(
      (await periodRows(componentId)).map((period) => [
        period.addedAt,
        period.removedAt
      ])
    ).toEqual([
      [ms('2025-12-01'), ms('2026-02-01')],
      [ms('2026-03-01'), ms('2026-03-15')],
      [ms('2026-04-01'), ms('2026-06-01')]
    ])
    // Clearing a bound always applies.
    await database.updateFitnessGearComponent({
      id: componentId,
      gearId,
      actorId,
      addedAt: null,
      removedAt: null
    })
    expect(
      (await periodRows(componentId)).map((period) => [
        period.addedAt,
        period.removedAt
      ])
    ).toEqual([
      [null, ms('2026-02-01')],
      [ms('2026-03-01'), ms('2026-03-15')],
      [ms('2026-04-01'), null]
    ])

    // An unchanged threshold keeps a fired reminder.
    await database.setFitnessGearComponentLastAlertedDistance({
      id: componentId,
      lastAlertedDistanceMeters: 2000
    })
    expect(
      (
        await database.updateFitnessGearComponent({
          id: componentId,
          gearId,
          actorId,
          serviceDistanceMeters: 2000
        })
      )?.lastAlertedDistanceMeters
    ).toBe(2000)

    expect(
      await database.updateFitnessGearComponent({
        id: componentId,
        gearId,
        actorId: otherActorId,
        componentType: 'Stolen'
      })
    ).toBeNull()
    expect((await componentRow(componentId)).componentType).toBe('Moved')
  })

  it('updateFitnessGearComponent moves both bounds of a single period together', async () => {
    const actorId = await newActor()
    const gearId = await seedGear(actorId)
    const componentId = await seedComponent(
      gearId,
      {},
      { addedAt: at('2026-01-01'), removedAt: at('2026-02-01') }
    )
    // A single-period neighbour on the same gear that the write must not touch.
    const neighbour = await seedComponent(
      gearId,
      {},
      { addedAt: at('2026-01-01'), removedAt: at('2026-02-01') }
    )
    // The whole window moves past its old end in one edit.
    await database.updateFitnessGearComponent({
      id: componentId,
      gearId,
      actorId,
      addedAt: at('2026-03-01'),
      removedAt: at('2026-04-01')
    })
    expect(
      (await periodRows(componentId)).map((period) => [
        period.addedAt,
        period.removedAt
      ])
    ).toEqual([[ms('2026-03-01'), ms('2026-04-01')]])
    expect(
      (await periodRows(neighbour)).map((period) => [
        period.addedAt,
        period.removedAt,
        period.updatedAt
      ])
    ).toEqual([[ms('2026-01-01'), ms('2026-02-01'), ms('2026-01-01')]])
    // An inverted pair is skipped whole.
    await database.updateFitnessGearComponent({
      id: componentId,
      gearId,
      actorId,
      addedAt: at('2026-05-01'),
      removedAt: at('2026-04-15')
    })
    expect(
      (await periodRows(componentId)).map((period) => [
        period.addedAt,
        period.removedAt
      ])
    ).toEqual([[ms('2026-03-01'), ms('2026-04-01')]])
  })

  it('component writes reach only a live component of the named, live gear', async () => {
    const actorId = await newActor()
    const gearId = await seedGear(actorId)
    const otherGearId = await seedGear(actorId)
    const deletedGearId = await seedGear(actorId, {
      deletedAt: at('2026-01-15')
    })
    // Every component is retired, so a refit that got through would open a
    // period on it.
    const retired = { removedAt: at('2026-02-01') }
    const live = await seedComponent(gearId, {}, retired)
    const deleted = await seedComponent(
      gearId,
      { deletedAt: at('2026-01-15') },
      retired
    )
    const onDeletedGear = await seedComponent(deletedGearId, {}, retired)

    const unreachable = [
      // No such component, on a gear that has one.
      { id: 'missing-component', gearId },
      // A live component, named under another of the actor's gear.
      { id: live, gearId: otherGearId },
      { id: deleted, gearId },
      { id: onDeletedGear, gearId: deletedGearId }
    ]
    for (const target of unreachable) {
      expect(
        await database.updateFitnessGearComponent({
          ...target,
          actorId,
          componentType: 'Changed'
        })
      ).toBeNull()
      expect(
        await database.refitFitnessGearComponent({ ...target, actorId })
      ).toBeNull()
    }
    for (const id of [live, deleted, onDeletedGear]) {
      expect((await componentRow(id)).componentType).toBe('Chain')
      expect(await periodRows(id)).toHaveLength(1)
    }
  })

  it('updateFitnessGearComponent moves one bound when the other end is open', async () => {
    const actorId = await newActor()
    const gearId = await seedGear(actorId)
    // Fitted: no removedAt, so a later start cannot invert the period.
    const fitted = await seedComponent(
      gearId,
      {},
      { addedAt: at('2026-01-01'), removedAt: null }
    )
    // Retired, with no recorded start: any end is ordered.
    const startless = await seedComponent(
      gearId,
      {},
      { addedAt: null, removedAt: at('2026-03-01') }
    )
    await database.updateFitnessGearComponent({
      id: fitted,
      gearId,
      actorId,
      addedAt: at('2026-02-01')
    })
    await database.updateFitnessGearComponent({
      id: startless,
      gearId,
      actorId,
      removedAt: at('2026-04-01')
    })
    expect(
      (await periodRows(fitted)).map((period) => [
        period.addedAt,
        period.removedAt
      ])
    ).toEqual([[ms('2026-02-01'), null]])
    expect(
      (await periodRows(startless)).map((period) => [
        period.addedAt,
        period.removedAt
      ])
    ).toEqual([[null, ms('2026-04-01')]])
  })

  it('updateFitnessGearComponent keeps nothing when the last period write fails', async () => {
    const actorId = await newActor()
    const gearId = await seedGear(actorId)
    const componentId = await seedComponent(
      gearId,
      {},
      {
        installSequence: 1,
        addedAt: at('2026-01-01'),
        removedAt: at('2026-02-01')
      }
    )
    const lastPeriod = await seedPeriod(componentId, {
      installSequence: 2,
      addedAt: at('2026-03-01'),
      removedAt: at('2026-04-01')
    })
    const drop = await failWrite(
      'fitness_gear_component_periods',
      'update',
      `old."id" = '${lastPeriod}'`
    )
    await expectRolledBack(drop, () =>
      database.updateFitnessGearComponent({
        id: componentId,
        gearId,
        actorId,
        componentType: 'Doomed',
        addedAt: at('2025-12-01'),
        removedAt: at('2026-05-01')
      })
    )
  })

  it('deleteFitnessGearComponent soft-deletes the owned component only', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const gearId = await seedGear(actorId)
    const componentId = await seedComponent(gearId)
    const neighbour = await seedComponent(gearId)

    expect(
      await database.deleteFitnessGearComponent({
        id: componentId,
        gearId,
        actorId: otherActorId
      })
    ).toBe(false)
    expect(
      await database.deleteFitnessGearComponent({
        id: componentId,
        gearId,
        actorId
      })
    ).toBe(true)
    expect((await componentRow(componentId)).deletedAt).toEqual(
      expect.any(Number)
    )
    expect(
      await database.deleteFitnessGearComponent({
        id: componentId,
        gearId,
        actorId
      })
    ).toBe(false)
    expect(await componentRow(neighbour)).toEqual(
      expect.objectContaining({ deletedAt: null, updatedAt: ms('2026-01-01') })
    )
  })

  it('retireFitnessGearComponent closes the open period of the owned component once', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const gearId = await seedGear(actorId)
    const componentId = await seedComponent(
      gearId,
      {},
      {
        installSequence: 1,
        addedAt: at('2026-01-01'),
        removedAt: at('2026-02-01')
      }
    )
    await seedPeriod(componentId, {
      installSequence: 2,
      addedAt: at('2026-03-01'),
      removedAt: null
    })
    const neighbour = await seedComponent(gearId, {}, { removedAt: null })

    expect(
      await database.retireFitnessGearComponent({
        id: componentId,
        gearId,
        actorId: otherActorId
      })
    ).toBeNull()
    const retired = await database.retireFitnessGearComponent({
      id: componentId,
      gearId,
      actorId
    })
    expect(retired?.removedAt).toEqual(expect.any(Number))
    const periods = await periodRows(componentId)
    expect(periods[0].removedAt).toBe(ms('2026-02-01'))
    expect(periods[1].removedAt).toBe(retired?.removedAt)
    expect((await componentRow(componentId)).updatedAt).toBe(retired?.removedAt)

    // Already retired: nothing is open, so nothing moves.
    expect(
      await database.retireFitnessGearComponent({
        id: componentId,
        gearId,
        actorId
      })
    ).toBeNull()
    expect(await periodRows(componentId)).toEqual(periods)

    expect(await periodRows(neighbour)).toEqual([
      expect.objectContaining({ removedAt: null })
    ])
    expect((await componentRow(neighbour)).updatedAt).toBe(ms('2026-01-01'))
  })

  it('refitFitnessGearComponent opens the next period of a retired component', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const gearId = await seedGear(actorId)
    const componentId = await seedComponent(
      gearId,
      {},
      { installSequence: 1, removedAt: at('2026-02-01') }
    )
    await seedPeriod(componentId, {
      installSequence: 3,
      addedAt: at('2026-04-01'),
      removedAt: at('2026-05-01')
    })
    await seedPeriod(componentId, {
      installSequence: 2,
      addedAt: at('2026-03-01'),
      removedAt: at('2026-03-15')
    })
    // A fitted neighbour on the same gear, with a higher sequence than any of
    // this component's.
    const neighbour = await seedComponent(
      gearId,
      {},
      { installSequence: 9, removedAt: null }
    )

    expect(
      await database.refitFitnessGearComponent({
        id: componentId,
        gearId,
        actorId: otherActorId
      })
    ).toBeNull()
    const refitted = await database.refitFitnessGearComponent({
      id: componentId,
      gearId,
      actorId
    })
    expect(refitted?.removedAt).toBeUndefined()
    expect(refitted?.periods.map((period) => period.installSequence)).toEqual([
      1, 2, 3, 4
    ])
    const opened = refitted!.periods[3]
    expect(opened.addedAt).toEqual(expect.any(Number))
    expect((await componentRow(componentId)).updatedAt).toBe(opened.addedAt)

    // Fitted now, so a second refit is a no-op.
    expect(
      await database.refitFitnessGearComponent({
        id: componentId,
        gearId,
        actorId
      })
    ).toBeNull()
    expect(await periodRows(componentId)).toHaveLength(4)
    expect(await periodRows(neighbour)).toHaveLength(1)
    expect((await componentRow(neighbour)).updatedAt).toBe(ms('2026-01-01'))
  })

  it('refitFitnessGearComponent treats a period closed at epoch 0 as closed', async () => {
    // Only a null removedAt keeps a period open, the same test retiring makes
    // in SQL. A legacy row closed at the epoch must not read as fitted.
    const actorId = await newActor()
    const gearId = await seedGear(actorId)
    const componentId = await seedComponent(
      gearId,
      {},
      { installSequence: 1, addedAt: new Date(0), removedAt: new Date(0) }
    )
    const refitted = await database.refitFitnessGearComponent({
      id: componentId,
      gearId,
      actorId
    })
    expect(refitted?.periods.map((period) => period.installSequence)).toEqual([
      1, 2
    ])
    expect(refitted?.periods[0].removedAt).toBe(0)
    expect(refitted?.removedAt).toBeUndefined()
  })

  it('refitFitnessGearComponent keeps nothing when the component update fails', async () => {
    const actorId = await newActor()
    const gearId = await seedGear(actorId)
    const componentId = await seedComponent(
      gearId,
      {},
      { removedAt: at('2026-02-01') }
    )
    const drop = await failWrite(
      'fitness_gear_components',
      'update',
      `old."id" = '${componentId}'`
    )
    await expectRolledBack(drop, () =>
      database.refitFitnessGearComponent({ id: componentId, gearId, actorId })
    )
  })

  it('refitFitnessGearComponent answers a unique violation on the period insert with null', async () => {
    const actorId = await newActor()
    const gearId = await seedGear(actorId)
    const componentId = await seedComponent(
      gearId,
      {},
      { removedAt: at('2026-02-01') }
    )
    const drop = await failWrite(
      'fitness_gear_component_periods',
      'insert',
      `new."componentId" = '${componentId}'`,
      { unique: true }
    )
    const before = await dumpTables()
    try {
      expect(
        await database.refitFitnessGearComponent({
          id: componentId,
          gearId,
          actorId
        })
      ).toBeNull()
    } finally {
      await drop()
    }
    expect(await dumpTables()).toEqual(before)
  })

  it('setFitnessGearComponentLastAlertedDistance wins only below the threshold, on live components', async () => {
    const actorId = await newActor()
    const gearId = await seedGear(actorId)
    const componentId = await seedComponent(gearId, {
      lastAlertedDistanceMeters: 5000
    })
    const unset = await seedComponent(gearId)
    const neighbour = await seedComponent(gearId, {
      lastAlertedDistanceMeters: 100
    })
    const deleted = await seedComponent(gearId, {
      deletedAt: at('2026-02-01')
    })

    expect(
      await database.setFitnessGearComponentLastAlertedDistance({
        id: componentId,
        lastAlertedDistanceMeters: 5000,
        onlyIfBelowThresholdMeters: 5000
      })
    ).toBe(false)
    expect((await componentRow(componentId)).updatedAt).toBe(ms('2026-01-01'))
    expect(
      await database.setFitnessGearComponentLastAlertedDistance({
        id: componentId,
        lastAlertedDistanceMeters: 6000,
        onlyIfBelowThresholdMeters: 6000
      })
    ).toBe(true)
    expect(
      await database.setFitnessGearComponentLastAlertedDistance({
        id: unset,
        lastAlertedDistanceMeters: 10,
        onlyIfBelowThresholdMeters: 10
      })
    ).toBe(true)
    expect(
      await database.setFitnessGearComponentLastAlertedDistance({
        id: componentId,
        lastAlertedDistanceMeters: 1
      })
    ).toBe(true)
    expect((await componentRow(componentId)).lastAlertedDistanceMeters).toBe(1)
    expect(
      await database.setFitnessGearComponentLastAlertedDistance({
        id: deleted,
        lastAlertedDistanceMeters: 1
      })
    ).toBe(false)
    expect((await componentRow(deleted)).lastAlertedDistanceMeters).toBeNull()
    expect((await componentRow(neighbour)).lastAlertedDistanceMeters).toBe(100)
  })
})

describe('getFitnessGearComponentDistanceRollups', () => {
  it('sums the countable activities inside each period of the requested gear', async () => {
    const actorId = await newActor()
    const otherActorId = await newActor()
    const gearId = await seedGear(actorId)
    const otherGear = await seedGear(actorId)
    const othersGear = await seedGear(otherActorId)
    const deletedGear = await seedGear(actorId, {
      deletedAt: at('2026-02-01')
    })

    const windowed = await seedComponent(
      gearId,
      {},
      { addedAt: at('2026-02-01'), removedAt: at('2026-04-01') }
    )
    const open = await seedComponent(
      gearId,
      {},
      { addedAt: null, removedAt: null }
    )
    const fromMarch = await seedComponent(
      gearId,
      {},
      { addedAt: at('2026-03-01'), removedAt: null }
    )
    const untilMarch = await seedComponent(
      gearId,
      {},
      { addedAt: null, removedAt: at('2026-03-01') }
    )
    const periodless = await seedComponent(gearId, {}, null)
    await seedComponent(gearId, { deletedAt: at('2026-02-01') })
    await seedComponent(otherGear)
    const othersComponent = await seedComponent(othersGear)
    await seedComponent(deletedGear)

    for (const [start, distance] of [
      ['2026-01-01', 1],
      // Exactly on a window's start: inside it.
      ['2026-02-01', 10],
      ['2026-03-01', 100],
      // Exactly on a window's end: outside it.
      ['2026-04-01', 1000],
      ['2026-05-01', 10000],
      [null, 100000]
    ] as const) {
      await seedFile(actorId, {
        gearId,
        activityStartTime: start ? at(start) : null,
        totalDistanceMeters: distance
      })
    }
    for (const values of [
      { processingStatus: 'pending' },
      { isPrimary: false },
      { deletedAt: at('2026-03-05') }
    ]) {
      await seedFile(actorId, {
        gearId,
        activityStartTime: at('2026-03-01'),
        totalDistanceMeters: 1_000_000,
        ...values
      })
    }
    await seedFile(otherActorId, {
      gearId,
      activityStartTime: at('2026-03-01'),
      totalDistanceMeters: 1_000_000
    })
    await seedFile(otherActorId, {
      gearId: othersGear,
      activityStartTime: at('2026-03-01'),
      totalDistanceMeters: 1_000_000
    })

    const rollups = await database.getFitnessGearComponentDistanceRollups({
      actorId,
      gearIds: [gearId, gearId, othersGear, deletedGear]
    })
    expect(rollups).toEqual({
      [windowed]: { distanceMeters: 110, activityCount: 2 },
      [open]: { distanceMeters: 111111, activityCount: 6 },
      [fromMarch]: { distanceMeters: 11100, activityCount: 3 },
      [untilMarch]: { distanceMeters: 11, activityCount: 2 },
      [periodless]: { distanceMeters: 0, activityCount: 0 }
    })
    expect(othersComponent in rollups).toBe(false)
    expect(
      await database.getFitnessGearComponentDistanceRollups({
        actorId,
        gearIds: []
      })
    ).toEqual({})
  })
})
