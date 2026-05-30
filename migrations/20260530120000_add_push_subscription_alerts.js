// Every alert flag enabled. Pre-existing rows all came from the legacy
// `/api/v1/push/subscribe` route (the only push route before this migration),
// which has no per-type alert concept and expects every notification. Delivery
// now filters by per-subscription alerts, treating a `false` flag as opt-out,
// and an unset `alerts` column parses to all-false — so existing rows must be
// backfilled to all-true or they would silently stop receiving notifications.
const ALL_ALERTS_ENABLED = {
  mention: true,
  status: true,
  reblog: true,
  follow: true,
  follow_request: true,
  favourite: true,
  poll: true,
  update: true,
  quote: true,
  quoted_update: true,
  'admin.sign_up': true,
  'admin.report': true
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('push_subscriptions', function (table) {
    // Mastodon WebPushSubscription preferences. `alerts` is stored as a JSON
    // string (text, not jsonb) so SQLite/MySQL/PostgreSQL all behave the same.
    table.text('alerts').nullable()
    table.string('policy').notNullable().defaultTo('all')
    table.boolean('standard').notNullable().defaultTo(false)
  })

  // Backfill pre-existing rows (identified by the not-yet-populated `alerts`
  // column). They all came from the legacy `/subscribe` route + browser
  // PushManager and were delivered with the standard `aes128gcm` encoding, so
  // mark them `standard: true` as well — otherwise the new encoding-follows-
  // the-flag delivery would switch them to legacy `aesgcm` and break them.
  await knex('push_subscriptions')
    .whereNull('alerts')
    .update({ alerts: JSON.stringify(ALL_ALERTS_ENABLED), standard: true })
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
