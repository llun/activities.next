/**
 * Drops `fitness_gears.stravaGearId` and its `(actorId, stravaGearId)` unique
 * index.
 *
 * The column existed solely so a Strava import could find — or create — a local
 * gear row keyed on Strava's own `gear_id`. Imports no longer read Strava's
 * gear at all: an imported activity is attributed from the athlete's own shed,
 * through the gear whose `defaultSports` claims the activity's sport (the
 * mapping the Strava settings page edits). With nothing writing or reading the
 * column, keeping it would leave a unique index that only ever constrains rows
 * no code can produce.
 *
 * Gear rows a previous import created are left exactly where they are — they
 * are ordinary gear now, with their names, components and attributed
 * activities intact. Only the Strava id linking them back is dropped, and it
 * has no reader left.
 *
 * The index is dropped in its own `alterTable` before the column: SQLite
 * rebuilds the table to drop a column, and an index still naming the departing
 * column is not something that survives the rebuild.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  const hasTable = await knex.schema.hasTable('fitness_gears')
  if (!hasTable) return

  const hasColumn = await knex.schema.hasColumn('fitness_gears', 'stravaGearId')
  if (!hasColumn) return

  await knex.schema.alterTable('fitness_gears', function (table) {
    table.dropUnique(
      ['actorId', 'stravaGearId'],
      'fitness_gears_actor_strava_gear_id_unique'
    )
  })

  await knex.schema.alterTable('fitness_gears', function (table) {
    table.dropColumn('stravaGearId')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  const hasTable = await knex.schema.hasTable('fitness_gears')
  if (!hasTable) return

  const hasColumn = await knex.schema.hasColumn('fitness_gears', 'stravaGearId')
  if (hasColumn) return

  await knex.schema.alterTable('fitness_gears', function (table) {
    table.string('stravaGearId').nullable()
  })

  await knex.schema.alterTable('fitness_gears', function (table) {
    table.unique(['actorId', 'stravaGearId'], {
      indexName: 'fitness_gears_actor_strava_gear_id_unique'
    })
  })
}
