/**
 * Gear tracking for fitness activities: bikes and shoes (`fitness_gears`), the
 * parts bolted to a bike (`fitness_gear_components`), and the `gearId` link on
 * `fitness_files` that attributes an activity to one piece of gear.
 *
 * Lifetime distance is deliberately NOT a column anywhere here. A gear total is
 * `SUM(fitness_files.totalDistanceMeters) WHERE gearId = ?`, and a component
 * total is the same sum restricted to activities inside its
 * `[addedAt, removedAt)` install window. Storing the total instead would have to
 * be reconciled on every back-dated upload, archive re-import, activity edit and
 * delete; derived totals are always consistent with the calendar for free.
 *
 * `fitness_files.gearId` is a plain indexed column with no database-level
 * foreign key: adding an FK constraint through `alterTable` requires a table
 * rebuild on SQLite, which no migration in this repo does. Ownership and
 * referential integrity are enforced in `lib/database/sql/fitnessGear.ts`, and
 * deleting gear nulls the column in the same transaction.
 *
 * `defaultSports` is a JSON-encoded string in a `text` column rather than
 * `jsonb` so SQLite, PostgreSQL and MySQL-compatible backends all behave the
 * same. `componentType` avoids the MySQL reserved word `type`.
 *
 * `stravaGearId` is the idempotency key for Strava imports — gear names are
 * editable on both sides, so a rename under name-keying would fork a duplicate.
 * The unique index is composite with `actorId` because two accounts can each
 * connect their own Strava; NULLs compare as distinct on both backends, so
 * locally-created gear is unconstrained.
 *
 * `lastAlertedDistanceMeters` records the derived total at which a service
 * reminder last fired, so a crossing notifies exactly once and re-arms when the
 * threshold is raised or the part is replaced.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  const hasGearTable = await knex.schema.hasTable('fitness_gears')
  if (!hasGearTable) {
    await knex.schema.createTable('fitness_gears', function (table) {
      table.string('id').primary()
      table
        .string('actorId')
        .notNullable()
        .references('id')
        .inTable('actors')
        .onDelete('CASCADE')
      table.string('kind').notNullable()
      table.string('name').notNullable()
      table.string('brand').nullable()
      table.string('model').nullable()
      table.string('bikeType').nullable()
      table.float('weightKilograms').nullable()
      table.text('defaultSports').nullable()
      table.float('alertDistanceMeters').nullable()
      table.float('lastAlertedDistanceMeters').nullable()
      table.text('notes').nullable()
      table.string('stravaGearId').nullable()
      table.timestamp('retiredAt', { useTz: true }).nullable()
      table.timestamp('createdAt', { useTz: true }).notNullable()
      table.timestamp('updatedAt', { useTz: true }).notNullable()
      table.timestamp('deletedAt', { useTz: true }).nullable()

      table.index(['actorId'], 'fitness_gears_actor_id_idx')
      table.unique(['actorId', 'stravaGearId'], {
        indexName: 'fitness_gears_actor_strava_gear_id_unique'
      })
    })
  }

  const hasComponentTable = await knex.schema.hasTable(
    'fitness_gear_components'
  )
  if (!hasComponentTable) {
    await knex.schema.createTable('fitness_gear_components', function (table) {
      table.string('id').primary()
      table
        .string('gearId')
        .notNullable()
        .references('id')
        .inTable('fitness_gears')
        .onDelete('CASCADE')
      table.string('componentType').notNullable()
      table.string('brand').nullable()
      table.string('model').nullable()
      table.timestamp('addedAt', { useTz: true }).nullable()
      table.timestamp('removedAt', { useTz: true }).nullable()
      table.float('serviceDistanceMeters').nullable()
      table.float('lastAlertedDistanceMeters').nullable()
      table.timestamp('createdAt', { useTz: true }).notNullable()
      table.timestamp('updatedAt', { useTz: true }).notNullable()
      table.timestamp('deletedAt', { useTz: true }).nullable()

      table.index(['gearId'], 'fitness_gear_components_gear_id_idx')
    })
  }

  const hasGearIdColumn = await knex.schema.hasColumn('fitness_files', 'gearId')
  if (!hasGearIdColumn) {
    await knex.schema.alterTable('fitness_files', function (table) {
      table.string('gearId').nullable()
      table.index(['gearId'], 'fitness_files_gear_id_idx')
    })
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  const hasGearIdColumn = await knex.schema.hasColumn('fitness_files', 'gearId')
  if (hasGearIdColumn) {
    await knex.schema.alterTable('fitness_files', function (table) {
      table.dropIndex(['gearId'], 'fitness_files_gear_id_idx')
      table.dropColumn('gearId')
    })
  }

  await knex.schema.dropTableIfExists('fitness_gear_components')
  await knex.schema.dropTableIfExists('fitness_gears')
}
