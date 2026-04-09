/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('fitness_heatmaps', function (table) {
    // Serialized sorted comma-separated region IDs, e.g. "netherlands,singapore"
    // NULL means no region filter (world-wide heatmap).
    table.string('region').nullable().defaultTo(null)
  })

  // Replace the old unique constraint (without region) with one that includes region.
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
