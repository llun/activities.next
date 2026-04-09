/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  // Add the region column as nullable first so we can backfill.
  await knex.schema.alterTable('fitness_heatmaps', function (table) {
    // Empty string '' = world-wide (no region filter).
    // Non-empty value = serialized sorted comma-separated region IDs.
    // We use '' rather than NULL so the column participates normally in the
    // UNIQUE constraint (both PostgreSQL and SQLite treat NULL as distinct,
    // which would allow duplicate world-wide rows when region IS NULL).
    table.string('region').nullable().defaultTo('')
  })

  // Backfill any existing rows that got NULL instead of ''
  await knex('fitness_heatmaps').whereNull('region').update({ region: '' })

  // Make non-nullable now that all rows have a value.
  await knex.schema.alterTable('fitness_heatmaps', function (table) {
    table.string('region').notNullable().defaultTo('').alter()
  })

  // Replace old unique constraint (without region) with one that includes region.
  await knex.schema.alterTable('fitness_heatmaps', function (table) {
    table.dropUnique(['actorId', 'activityType', 'periodType', 'periodKey'])
    table.unique([
      'actorId',
      'activityType',
      'periodType',
      'periodKey',
      'region'
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
      'region'
    ])
    table.unique(['actorId', 'activityType', 'periodType', 'periodKey'])
  })

  await knex.schema.alterTable('fitness_heatmaps', function (table) {
    table.dropColumn('region')
  })
}
