/**
 * Drops `recipientsTypeActorIdIndex` ON recipients (type, "actorId"), added by
 * `20250216112921_add_recipients_type_actorId_index.js`.
 *
 * `20260207220000_add_recipients_timeline_local_public_index.js` added
 * `recipients_type_actor_created_status_idx` ON (type, "actorId", "createdAt",
 * "statusId") — a strict prefix-superset, so every access path the two-column
 * index could serve is also served by the four-column one. No query builds a
 * (type, "actorId") predicate: reads of `recipients` are either correlated on
 * `statusId` (covered by recipients_status_type_actor_idx) or filter on
 * `actorId` alone (covered by recipients_actorId_statusId_idx), which a
 * type-led index cannot serve at all.
 *
 * Migrations run with `disableTransactions: true`, so this stays a single
 * statement.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = function (knex) {
  return knex.schema.alterTable('recipients', function (table) {
    table.dropIndex(['type', 'actorId'], 'recipientsTypeActorIdIndex')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = function (knex) {
  return knex.schema.alterTable('recipients', function (table) {
    table.index(['type', 'actorId'], 'recipientsTypeActorIdIndex')
  })
}
