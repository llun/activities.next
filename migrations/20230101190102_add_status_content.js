/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) => {
  return knex.schema.alterTable('statuses', function (table) {
    table.text('content')
    table.dropColumn('text')
    table.dropColumn('summary')
    table.dropColumn('url')
    table.dropColumn('sensitive')
    table.dropColumn('visibility')
    table.dropColumn('language')
    table.dropColumn('thread')
    table.dropColumn('conversation')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => {
  return knex.schema.alterTable('statuses', function (table) {
    table.dropColumn('content')
    table.text('text')
    table.text('summary')
    table.string('url')
    table.boolean('sensitive')
    table.string('visibility')
    table.string('language')
    table.string('thread')
    table.string('conversation')
  })
}
