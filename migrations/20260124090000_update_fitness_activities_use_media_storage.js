/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) => {
  return knex.schema.alterTable('fitness_activities', function (table) {
    // Remove the rawData JSONB column
    table.dropColumn('rawData')
    // Add mediaId to link to the media storage entry containing raw activity data
    table.string('mediaId')
    table.index(['mediaId'], 'fitness_activities_media')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => {
  return knex.schema.alterTable('fitness_activities', function (table) {
    table.dropIndex(['mediaId'], 'fitness_activities_media')
    table.dropColumn('mediaId')
    table.jsonb('rawData')
  })
}
