/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) => {
  return knex.schema.alterTable('actors', function (table) {
    table.dropUnique(['username'], 'actors_preferredUsername_unique')
    table.unique(['username', 'domain'])
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => {
  return knex.schema.alterTable('actors', function (table) {
    table.dropUnique(['username', 'domain'])
    table.unique(['username'])
  })
}
