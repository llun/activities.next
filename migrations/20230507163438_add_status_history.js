/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) => {
  return knex.schema
    .createTable('status_history', function (table) {
      table.increments('id')
      table.string('statusId')
      table.jsonb('data')

      table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
      table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

      table.index(['statusId', 'createdAt', 'updatedAt'], 'statusHistoryIndex')
    })
    .renameTable('accountProviders', 'account_providers')
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => {
  return knex.schema
    .dropTable('status_history')
    .renameTable('account_providers', 'accountProviders')
}
