/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.alterTable('actors', function (table) {
    // Status of deletion: null = normal, 'scheduled' = pending deletion, 'deleting' = in progress
    table.string('deletionStatus').nullable()
    // When the actor is scheduled to be deleted (for delayed deletion)
    table.timestamp('deletionScheduledAt', { useTz: true }).nullable()
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('actors', function (table) {
    table.dropColumn('deletionStatus')
    table.dropColumn('deletionScheduledAt')
  })
}
