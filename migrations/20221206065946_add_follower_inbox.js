/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) => {
  return knex.schema.alterTable('follows', function (table) {
    table.string('inbox')
    table.string('sharedInbox')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => {
  return knex.schema.alterTable('follows', function (table) {
    table.dropColumn('inbox')
    table.dropColumn('sharedInbox')
  })
}
