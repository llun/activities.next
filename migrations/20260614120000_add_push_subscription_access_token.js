/**
 * Adds an `accessToken` column to `push_subscriptions`.
 *
 * Mastodon's Web Push payload (see `Web::NotificationSerializer`) includes the
 * plaintext OAuth `access_token` tied to the subscription. Native clients (the
 * Mastodon iOS app, Ivory, …) decode the encrypted payload and use this token
 * to attribute the push to the right account and to fetch the full notification
 * via `GET /api/v1/notifications/:id`. Without it the payload fails to decode
 * into the client's expected struct and the notification renders with no
 * content (only the app icon).
 *
 * The token is captured from the `Authorization: Bearer …` header when a
 * subscription is created via an OAuth token. Browser PushManager subscriptions
 * authenticate via the web session (no bearer token) and leave this null — the
 * built-in service worker does not need it.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.alterTable('push_subscriptions', function (table) {
    table.text('accessToken').nullable()
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('push_subscriptions', function (table) {
    table.dropColumn('accessToken')
  })
}
