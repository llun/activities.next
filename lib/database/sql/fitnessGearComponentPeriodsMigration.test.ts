import knex from 'knex'

import * as migration from '@/migrations/20260826120000_add_fitness_gear_component_periods'

/**
 * The backfill is the whole risk of this migration: the windows only exist on
 * the component rows until it runs, and the columns are dropped straight after.
 * A component that came out the other side with no period would claim every
 * activity ever ridden on its gear.
 */
describe('fitness gear component periods migration', () => {
  const createDatabase = async () => {
    const database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })

    await database.schema.createTable('fitness_gears', (table) => {
      table.string('id').primary()
    })
    await database.schema.createTable('fitness_gear_components', (table) => {
      table.string('id').primary()
      table
        .string('gearId')
        .notNullable()
        .references('id')
        .inTable('fitness_gears')
        .onDelete('CASCADE')
      table.string('componentType').notNullable()
      table.timestamp('addedAt', { useTz: true }).nullable()
      table.timestamp('removedAt', { useTz: true }).nullable()
      table.timestamp('createdAt', { useTz: true }).notNullable()
      table.timestamp('updatedAt', { useTz: true }).notNullable()
      table.timestamp('deletedAt', { useTz: true }).nullable()

      table.index(['gearId'], 'fitness_gear_components_gear_id_idx')
    })
    await database('fitness_gears').insert({ id: 'gear-1' })

    return database
  }

  it('gives every component one period carrying the window it already had', async () => {
    const database = await createDatabase()

    try {
      const createdAt = new Date('2026-01-01T00:00:00.000Z')
      await database('fitness_gear_components').insert([
        {
          id: 'component-open',
          gearId: 'gear-1',
          componentType: 'Frame',
          addedAt: null,
          removedAt: null,
          createdAt,
          updatedAt: createdAt
        },
        {
          id: 'component-dated',
          gearId: 'gear-1',
          componentType: 'Chain',
          addedAt: new Date('2026-02-01T00:00:00.000Z'),
          removedAt: new Date('2026-03-01T00:00:00.000Z'),
          createdAt,
          updatedAt: createdAt
        },
        {
          // A soft-deleted component is backfilled too: leaving it periodless
          // would make it claim everything if it were ever restored.
          id: 'component-deleted',
          gearId: 'gear-1',
          componentType: 'Cassette',
          addedAt: new Date('2026-02-01T00:00:00.000Z'),
          removedAt: null,
          createdAt,
          updatedAt: createdAt,
          deletedAt: new Date('2026-04-01T00:00:00.000Z')
        }
      ])

      await migration.up(database)

      const periods = await database('fitness_gear_component_periods')
        .orderBy('componentId', 'asc')
        .select('*')
      expect(periods).toHaveLength(3)
      expect(periods.every((period) => period.installSequence === 1)).toBe(true)

      const byComponent = Object.fromEntries(
        periods.map((period) => [period.componentId, period])
      )
      expect(byComponent['component-open']).toMatchObject({
        addedAt: null,
        removedAt: null
      })
      expect(byComponent['component-dated'].addedAt).toEqual(
        Date.parse('2026-02-01T00:00:00.000Z')
      )
      expect(byComponent['component-dated'].removedAt).toEqual(
        Date.parse('2026-03-01T00:00:00.000Z')
      )
      expect(byComponent['component-deleted'].addedAt).toEqual(
        Date.parse('2026-02-01T00:00:00.000Z')
      )
      // The period carries the component's own timestamps, not the moment of
      // migration: it IS the window the component already had.
      expect(byComponent['component-dated'].createdAt).toEqual(
        createdAt.getTime()
      )

      // And the columns are gone, so nothing can read a second source of truth.
      expect(
        await database.schema.hasColumn('fitness_gear_components', 'addedAt')
      ).toBe(false)
      expect(
        await database.schema.hasColumn('fitness_gear_components', 'removedAt')
      ).toBe(false)
    } finally {
      await database.destroy()
    }
  })

  it('refuses a second open period per component', async () => {
    const database = await createDatabase()

    try {
      await database('fitness_gear_components').insert({
        id: 'component-1',
        gearId: 'gear-1',
        componentType: 'Chain',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z')
      })
      await migration.up(database)
      // The backfill wrote period 1; clear it so this test owns the sequence.
      await database('fitness_gear_component_periods').delete()

      const row = {
        componentId: 'component-1',
        addedAt: new Date('2026-01-01T00:00:00.000Z'),
        removedAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
      }
      await database('fitness_gear_component_periods').insert({
        ...row,
        id: 'period-1',
        installSequence: 1
      })

      // Two refits racing read the same highest sequence and both try to claim
      // the next one; the unique index is what makes exactly one of them win.
      await expect(
        database('fitness_gear_component_periods').insert({
          ...row,
          id: 'period-2',
          installSequence: 1
        })
      ).rejects.toThrow()
    } finally {
      await database.destroy()
    }
  })

  it('rolls back to the outermost window it can still represent', async () => {
    const database = await createDatabase()

    try {
      await database('fitness_gear_components').insert({
        id: 'component-1',
        gearId: 'gear-1',
        componentType: 'Chain',
        addedAt: new Date('2026-01-01T00:00:00.000Z'),
        removedAt: new Date('2026-02-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z')
      })
      await migration.up(database)

      // A refit, as `refitFitnessGearComponent` writes it.
      await database('fitness_gear_component_periods').insert({
        id: 'period-2',
        componentId: 'component-1',
        installSequence: 2,
        addedAt: new Date('2026-08-01T00:00:00.000Z'),
        removedAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
      })

      await migration.down(database)

      const component = await database('fitness_gear_components')
        .where('id', 'component-1')
        .first()
      // The first period's start and the last period's end. The gap between
      // them is what one window cannot hold — the rollback is lossy, which is
      // the point the periods table exists to make.
      expect(component.addedAt).toEqual(Date.parse('2026-01-01T00:00:00.000Z'))
      expect(component.removedAt).toBeNull()
      expect(
        await database.schema.hasTable('fitness_gear_component_periods')
      ).toBe(false)
    } finally {
      await database.destroy()
    }
  })
})
