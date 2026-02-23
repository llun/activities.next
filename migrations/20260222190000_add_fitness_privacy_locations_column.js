/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('fitness_settings', function (table) {
    table.jsonb('privacyLocations').notNullable().defaultTo('[]')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('fitness_settings', function (table) {
    table.dropColumn('privacyLocations')
  })
}
