/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  await knex.schema.alterTable('fitness_settings', function (table) {
    table.jsonb('privacyLocations').notNullable().defaultTo('[]')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  await knex.schema.alterTable('fitness_settings', function (table) {
    table.dropColumn('privacyLocations')
  })
}
