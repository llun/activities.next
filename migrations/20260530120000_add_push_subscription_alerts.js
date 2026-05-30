/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.alterTable('push_subscriptions', function (table) {
    // Mastodon WebPushSubscription preferences. `alerts` is stored as a JSON
    // string (text, not jsonb) so SQLite/MySQL/PostgreSQL all behave the same.
    table.text('alerts').nullable()
    table.string('policy').notNullable().defaultTo('all')
    table.boolean('standard').notNullable().defaultTo(false)
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('push_subscriptions', function (table) {
    table.dropColumn('alerts')
    table.dropColumn('policy')
    table.dropColumn('standard')
  })
}
