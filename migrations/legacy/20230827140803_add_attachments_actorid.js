/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = (knex) => {
  return knex.schema.alterTable('attachments', function (table) {
    table.string('actorId')

    table.index(['actorId'], 'attachments_actorId_idx')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = (knex) => {
  return knex.schema.alterTable('attachments', function (table) {
    table.dropIndex(['actorId'], 'attachments_actorId_idx')
    table.dropColumns('actorId')
  })
}
