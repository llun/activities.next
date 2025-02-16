/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .alterTable('statuses', function (table) {
      table.index('reply', 'statusesReplyIndex')
    })
    .alterTable('actors', function (table) {
      table.dropColumn('urls')
    })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .alterTable('statuses', function (table) {
      table.dropIndex('reply', 'statusesReplyIndex')
    })
    .alterTable('actors', function (table) {
      table.text('urls')
    })
}
