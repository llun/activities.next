/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  // Add the regions column (sorted comma-separated region IDs, empty = worldwide)
  await knex.schema.alterTable('fitness_heatmaps', function (table) {
    table.string('regions').notNullable().defaultTo('')
  })

  // Drop the old unique constraint and recreate with regions included.
  // SQLite does not support DROP CONSTRAINT, so we use dropUnique which maps
  // to DROP INDEX in SQLite and ALTER TABLE DROP CONSTRAINT in Postgres.
  await knex.schema.alterTable('fitness_heatmaps', function (table) {
    table.dropUnique(['actorId', 'activityType', 'periodType', 'periodKey'])
    table.unique([
      'actorId',
      'activityType',
      'periodType',
      'periodKey',
      'regions'
    ])
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('fitness_heatmaps', function (table) {
    table.dropUnique([
      'actorId',
      'activityType',
      'periodType',
      'periodKey',
      'regions'
    ])
    table.unique(['actorId', 'activityType', 'periodType', 'periodKey'])
    table.dropColumn('regions')
  })
}
