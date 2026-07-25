import knex, { Knex } from 'knex'

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
      table.string('actorId')
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

  it('reports the ACTOR of an unusable row, not the settings-row id', async () => {
    const warn = vi.spyOn(console, 'warn')
    await database('fitness_settings').insert({
      id: 'settings-row-1',
      actorId: 'actor-1',
      privacyHideRadiusMeters: null,
      privacyLocations: 'not-json{'
    })

    await migration.up(database)

    // fitness_settings.id is an unrelated UUID; an operator pasting it into an
    // actor lookup would find nothing.
    const [message] = warn.mock.calls.at(-1) ?? []
    expect(String(message)).toContain('actor-1')
    expect(String(message)).not.toContain('settings-row-1')
    // Such a row still falls back to the legacy home zone, so the warning must
    // not claim the actor has no protection at all.
    expect(String(message)).not.toMatch(/NO privacy zones/i)
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

  // Pins the migration's OWN duplicated option list by exercising every
  // boundary. Deliberately not compared against FITNESS_PRIVACY_RADIUS_OPTIONS:
  // the migration keeps its historical behaviour on purpose, so a future option
  // added to the app must arrive as a NEW migration rather than an edit to this
  // applied one. A typo in the migration's array is caught here instead.
  it.each([
    { description: 'snaps 1 up to 50', stored: 1, expected: 50 },
    { description: 'keeps 50 at 50', stored: 50, expected: 50 },
    { description: 'snaps 51 up to 100', stored: 51, expected: 100 },
    { description: 'snaps 150 up to 200', stored: 150, expected: 200 },
    { description: 'snaps 250 up to 500', stored: 250, expected: 500 },
    { description: 'snaps 600 up to 1000', stored: 600, expected: 1000 },
    { description: 'keeps 1000 at 1000', stored: 1000, expected: 1000 },
    {
      description: 'clamps 5000 down to the 1000 maximum',
      stored: 5000,
      expected: 1000
    }
  ])(
    '$description',
    async ({ stored, expected }: { stored: number; expected: number }) => {
      await database('fitness_settings').insert({
        id: '1',
        actorId: 'actor-1',
        privacyHideRadiusMeters: stored,
        privacyLocations: JSON.stringify([
          { latitude: 1, longitude: 2, hideRadiusMeters: stored }
        ])
      })

      await migration.up(database)

      const [row] = await readRows(database)
      expect(row.privacyHideRadiusMeters).toBe(expected)
      expect(JSON.parse(String(row.privacyLocations))).toEqual([
        { latitude: 1, longitude: 2, hideRadiusMeters: expected }
      ])
    }
  )
})
