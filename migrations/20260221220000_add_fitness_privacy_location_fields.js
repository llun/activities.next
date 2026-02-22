/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('fitness_settings', function (table) {
    table.double('privacyHomeLatitude')
    table.double('privacyHomeLongitude')
    table.integer('privacyHideRadiusMeters')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('fitness_settings', function (table) {
    table.dropColumn('privacyHomeLatitude')
    table.dropColumn('privacyHomeLongitude')
    table.dropColumn('privacyHideRadiusMeters')
  })
}
