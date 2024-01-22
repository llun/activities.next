/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) => {
  return knex.schema.alterTable('actors', function (table) {
    table.renameColumn('preferredUsername', 'username')
    table.string('domain')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => {
  return knex.schema.alterTable('actors', function (table) {
    table.renameColumn('username', 'preferredUsername')
    table.dropColumn('domain')
  })
}
