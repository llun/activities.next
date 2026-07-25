import knex, { Knex } from 'knex'

import { FITNESS_PRIVACY_RADIUS_OPTIONS } from '@/lib/services/fitness-files/privacy'
import * as migration from '@/migrations/20260725000000_snap_fitness_privacy_radius'

interface SettingsRow {
  id: string
  privacyHideRadiusMeters: number | null
  privacyLocations: string | null
}

const readRows = async (database: Knex): Promise<SettingsRow[]> =>
  database('fitness_settings')
    .select('id', 'privacyHideRadiusMeters', 'privacyLocations')
    .orderBy('id')

describe('snap fitness privacy radius migration', () => {
  let database: Knex

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })

    await database.schema.createTable('fitness_settings', (table) => {
      table.string('id').primary()
      table.integer('privacyHideRadiusMeters')
      table.json('privacyLocations')
    })

    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await database.destroy()
  })

  it('snaps a legacy radius and every legacy entry up to the 50m floor', async () => {
    await database('fitness_settings').insert({
      id: '1',
      privacyHideRadiusMeters: 20,
      privacyLocations: JSON.stringify([
        { latitude: 1, longitude: 2, hideRadiusMeters: 20 },
        { latitude: 3, longitude: 4, hideRadiusMeters: 5 }
      ])
    })

    await migration.up(database)

    const [row] = await readRows(database)
    expect(row.privacyHideRadiusMeters).toBe(50)
    expect(JSON.parse(String(row.privacyLocations))).toEqual([
      { latitude: 1, longitude: 2, hideRadiusMeters: 50 },
      { latitude: 3, longitude: 4, hideRadiusMeters: 50 }
    ])
  })

  it('preserves fields the migration does not know about', async () => {
    await database('fitness_settings').insert({
      id: '1',
      privacyHideRadiusMeters: 20,
      privacyLocations: JSON.stringify([
        { latitude: 1, longitude: 2, hideRadiusMeters: 20, label: 'Home' }
      ])
    })

    await migration.up(database)

    const [row] = await readRows(database)
    expect(JSON.parse(String(row.privacyLocations))).toEqual([
      { latitude: 1, longitude: 2, hideRadiusMeters: 50, label: 'Home' }
    ])
  })

  it.each([
    {
      description: 'leaves an already-supported radius alone',
      radius: 50,
      locations: JSON.stringify([
        { latitude: 1, longitude: 2, hideRadiusMeters: 50 }
      ])
    },
    {
      description: 'leaves a disabled zone disabled',
      radius: 0,
      locations: JSON.stringify([])
    },
    {
      description: 'leaves a null radius null',
      radius: null,
      locations: JSON.stringify([])
    },
    {
      description: 'leaves unparseable locations exactly as found',
      radius: null,
      locations: 'not-json{'
    },
    {
      description: 'leaves non-array locations exactly as found',
      radius: null,
      locations: JSON.stringify({ latitude: 1 })
    }
  ])(
    '$description',
    async ({
      radius,
      locations
    }: {
      radius: number | null
      locations: string
    }) => {
      await database('fitness_settings').insert({
        id: '1',
        privacyHideRadiusMeters: radius,
        privacyLocations: locations
      })

      await migration.up(database)

      const [row] = await readRows(database)
      expect(row.privacyHideRadiusMeters).toBe(radius)
      expect(row.privacyLocations).toBe(locations)
    }
  )

  it('leaves an entry radius it cannot interpret rather than zeroing it', async () => {
    // Writing 0 would mean "no zone" and would destroy a value a later fix
    // could still coerce.
    await database('fitness_settings').insert({
      id: '1',
      privacyHideRadiusMeters: null,
      privacyLocations: JSON.stringify([
        { latitude: 1, longitude: 2, hideRadiusMeters: '20' },
        { latitude: 3, longitude: 4 }
      ])
    })

    await migration.up(database)

    const [row] = await readRows(database)
    expect(JSON.parse(String(row.privacyLocations))).toEqual([
      { latitude: 1, longitude: 2, hideRadiusMeters: '20' },
      { latitude: 3, longitude: 4 }
    ])
  })

  it('reports unparseable rows so an operator can inspect them', async () => {
    const warn = vi.spyOn(console, 'warn')
    await database('fitness_settings').insert({
      id: 'broken-1',
      privacyHideRadiusMeters: null,
      privacyLocations: 'not-json{'
    })

    await migration.up(database)

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('broken-1'))
  })

  it('is idempotent', async () => {
    await database('fitness_settings').insert({
      id: '1',
      privacyHideRadiusMeters: 20,
      privacyLocations: JSON.stringify([
        { latitude: 1, longitude: 2, hideRadiusMeters: 5 }
      ])
    })

    await migration.up(database)
    const afterFirst = await readRows(database)
    await migration.up(database)

    expect(await readRows(database)).toEqual(afterFirst)
  })

  it('walks past a full page of rows', async () => {
    // The chunk loop is 500 wide; seed more than that so the keyset pagination
    // is actually exercised rather than short-circuiting on the first page.
    // Insert in batches: SQLite caps the number of compound SELECT terms a
    // single multi-row INSERT can carry.
    const seedRows = Array.from({ length: 501 }, (_, index) => ({
      id: `row-${String(index).padStart(4, '0')}`,
      privacyHideRadiusMeters: 20,
      privacyLocations: JSON.stringify([])
    }))
    for (let offset = 0; offset < seedRows.length; offset += 100) {
      await database('fitness_settings').insert(
        seedRows.slice(offset, offset + 100)
      )
    }

    await migration.up(database)

    const rows = await readRows(database)
    expect(rows).toHaveLength(501)
    expect(rows.every((row) => row.privacyHideRadiusMeters === 50)).toBe(true)
  })

  it('snaps to the option set this migration shipped with', () => {
    // Frozen on purpose. The migration duplicates the list because migrations
    // must keep behaving the same after app code moves on — so this pins the
    // historical snap rather than tracking FITNESS_PRIVACY_RADIUS_OPTIONS. If
    // the app's set changes, add a NEW migration; never edit an applied one.
    expect([0, 50, 100, 200, 500, 1000]).toEqual([
      ...FITNESS_PRIVACY_RADIUS_OPTIONS
    ])
  })
})
