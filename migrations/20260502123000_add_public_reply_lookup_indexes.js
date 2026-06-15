/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.schema.alterTable('recipients', function (table) {
    table.index(['actorId', 'statusId'], 'recipients_actorId_statusId_idx')
  })

  await knex.schema.alterTable('statuses', function (table) {
    table.index(['reply', 'type'], 'statuses_reply_type_idx')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.schema.alterTable('statuses', function (table) {
    table.dropIndex(['reply', 'type'], 'statuses_reply_type_idx')
  })

  await knex.schema.alterTable('recipients', function (table) {
    table.dropIndex(['actorId', 'statusId'], 'recipients_actorId_statusId_idx')
  })
}
