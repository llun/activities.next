/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) => {
  return knex.schema.alterTable('attachments', function (table) {
    table.string('actorId')

    table.index(['actorId'], 'attachments_actorId_idx')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => {
  return knex.schema.alterTable('attachments', function (table) {
    table.dropIndex(['actorId'], 'attachments_actorId_idx')
    table.dropColumns('actorId')
  })
}
