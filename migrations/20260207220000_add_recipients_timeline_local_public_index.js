/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.alterTable('recipients', function (table) {
    table.index(
      ['type', 'actorId', 'createdAt', 'statusId'],
      'recipients_type_actor_created_status_idx'
    )
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('recipients', function (table) {
    table.dropIndex(
      ['type', 'actorId', 'createdAt', 'statusId'],
      'recipients_type_actor_created_status_idx'
    )
  })
}
