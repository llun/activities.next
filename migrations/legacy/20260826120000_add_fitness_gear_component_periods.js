import crypto from 'crypto'

/**
 * Gives a gear component a HISTORY of install periods instead of the single
 * `[addedAt, removedAt)` window it carried on its own row.
 *
 * One window cannot describe a part that comes off and goes back on. Clearing
 * `removedAt` — which is what the components card's Unretire did — reopened the
 * ORIGINAL window, so a part unretired months later was retroactively credited
 * every activity ridden while it sat off the bike, and re-retiring did not take
 * that back: it only closed the window again at the new `now`. A genuine refit
 * (a wheelset off for the winter and back on in spring) could not be expressed
 * at all without crediting the winter.
 *
 * `addedAt` and `removedAt` therefore move OFF `fitness_gear_components` and
 * into a row per period. They survive as derived values — the first period's
 * start and the last period's end — so every reader that asks a component when
 * it went on still gets the same answer. Keeping the columns as a denormalised
 * copy of the latest period was the alternative and was rejected for the reason
 * the distance totals are derived rather than stored: a second source of truth
 * for the same fact drifts, and nothing downstream can tell that it has.
 *
 * `installSequence` — not `addedAt` — is the ordering key. The first period's
 * `addedAt` is nullable ("since the gear's beginning"), and the backends
 * disagree on whether NULLs sort first or last, which is the same reason
 * `getFitnessGearComponents` splits its own list in JS rather than in SQL.
 *
 * The UNIQUE on `(componentId, installSequence)` is the concurrency guard, and
 * it is deliberately a PLAIN unique index rather than the partial
 * `(componentId) WHERE removedAt IS NULL` that expresses "at most one open
 * period" directly. Knex emits a partial index's predicate on PostgreSQL and
 * SQLite but DROPS it on MySQL-compatible clients (see
 * `20260820000000_add_local_public_timeline_indexes.js`), and a predicate-less
 * `UNIQUE(componentId)` would forbid a second period outright — refitting would
 * fail on those backends forever. Sequencing gets the same protection portably:
 * two concurrent refits both read the highest sequence, both try to claim the
 * next one, and exactly one wins at the database. Two open periods is the
 * failure that matters, because the rollup would then count every later
 * activity twice.
 *
 * The backfill gives every existing component exactly one period holding the
 * window it already had, soft-deleted rows included — a component with no
 * period at all is a shape the rollup must never meet (its window tests would
 * both be vacuously true and it would claim every activity on the gear).
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  const hasComponentTable = await knex.schema.hasTable(
    'fitness_gear_components'
  )
  if (!hasComponentTable) return

  const hasPeriodTable = await knex.schema.hasTable(
    'fitness_gear_component_periods'
  )
  if (!hasPeriodTable) {
    await knex.schema.createTable(
      'fitness_gear_component_periods',
      function (table) {
        table.string('id').primary()
        table
          .string('componentId')
          .notNullable()
          .references('id')
          .inTable('fitness_gear_components')
          .onDelete('CASCADE')
        table.integer('installSequence').notNullable()
        table.timestamp('addedAt', { useTz: true }).nullable()
        table.timestamp('removedAt', { useTz: true }).nullable()
        table.timestamp('createdAt', { useTz: true }).notNullable()
        table.timestamp('updatedAt', { useTz: true }).notNullable()

        table.index(
          ['componentId'],
          'fitness_gear_component_periods_component_id_idx'
        )
        table.unique(['componentId', 'installSequence'], {
          indexName: 'fitness_gear_component_periods_sequence_unique'
        })
      }
    )
  }

  // Backfill before the columns go: once they are dropped the windows are gone.
  // Guarded on the columns still existing so a re-run after a partially applied
  // migration does not insert a second period per component.
  const hasAddedAt = await knex.schema.hasColumn(
    'fitness_gear_components',
    'addedAt'
  )
  if (hasAddedAt) {
    const BATCH_SIZE = 500
    let lastId = ''
    for (;;) {
      const components = await knex('fitness_gear_components')
        .where('id', '>', lastId)
        .orderBy('id', 'asc')
        .limit(BATCH_SIZE)
        .select('id', 'addedAt', 'removedAt', 'createdAt', 'updatedAt')
      if (components.length === 0) break

      await knex('fitness_gear_component_periods').insert(
        components.map((component) => ({
          id: crypto.randomUUID(),
          componentId: component.id,
          installSequence: 1,
          addedAt: component.addedAt ?? null,
          removedAt: component.removedAt ?? null,
          // The period IS the window the component already had, so it carries
          // the component's own timestamps rather than the moment of migration.
          createdAt: component.createdAt,
          updatedAt: component.updatedAt
        }))
      )

      lastId = components[components.length - 1].id
      if (components.length < BATCH_SIZE) break
    }

    // Neither column is indexed, so SQLite's table rebuild has no index naming
    // a departing column to survive — unlike the `stravaGearId` drop, which had
    // to drop its unique index in a separate `alterTable` first.
    await knex.schema.alterTable('fitness_gear_components', function (table) {
      table.dropColumn('addedAt')
      table.dropColumn('removedAt')
    })
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  const hasComponentTable = await knex.schema.hasTable(
    'fitness_gear_components'
  )
  if (!hasComponentTable) return

  const hasAddedAt = await knex.schema.hasColumn(
    'fitness_gear_components',
    'addedAt'
  )
  if (!hasAddedAt) {
    await knex.schema.alterTable('fitness_gear_components', function (table) {
      table.timestamp('addedAt', { useTz: true }).nullable()
      table.timestamp('removedAt', { useTz: true }).nullable()
    })

    const hasPeriodTable = await knex.schema.hasTable(
      'fitness_gear_component_periods'
    )
    if (hasPeriodTable) {
      // The single window a one-window model can hold: the first period's start
      // and the last period's end. A component that was refitted loses its gaps
      // here, which is the information the old shape could not carry — the
      // rollback is lossy on purpose rather than silently.
      const periods = await knex('fitness_gear_component_periods')
        .orderBy('componentId', 'asc')
        .orderBy('installSequence', 'asc')
        .select('componentId', 'installSequence', 'addedAt', 'removedAt')

      const windows = new Map()
      for (const period of periods) {
        const existing = windows.get(period.componentId)
        if (!existing) {
          windows.set(period.componentId, {
            addedAt: period.addedAt ?? null,
            removedAt: period.removedAt ?? null
          })
          continue
        }
        existing.removedAt = period.removedAt ?? null
      }

      for (const [componentId, window] of windows) {
        await knex('fitness_gear_components')
          .where('id', componentId)
          .update({ addedAt: window.addedAt, removedAt: window.removedAt })
      }
    }
  }

  await knex.schema.dropTableIfExists('fitness_gear_component_periods')
}
