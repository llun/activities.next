/**
 * Adds the `filtered` flag to notifications. A notification is `filtered` when
 * the recipient's notification policy routed it to the per-sender requests
 * queue instead of the main timeline. This single column is the spine for the
 * notification policy, the requests queue, and the `include_filtered` param.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) => {
  return knex.schema.alterTable('notifications', function (table) {
    table.boolean('filtered').notNullable().defaultTo(false)
    table.index(
      ['actorId', 'filtered', 'createdAt'],
      'notifications_actor_filtered'
    )
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => {
  return knex.schema.alterTable('notifications', function (table) {
    table.dropIndex(
      ['actorId', 'filtered', 'createdAt'],
      'notifications_actor_filtered'
    )
    table.dropColumn('filtered')
  })
}
