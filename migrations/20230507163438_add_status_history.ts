import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema
    .createTable('status_history', function (table) {
      table.increments('id')
      table.string('statusId')
      table.json('data')

      table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
      table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

      table.index(['statusId', 'createdAt', 'updatedAt'], 'statusHistoryIndex')
    })
    .renameTable('accountProviders', 'account_providers')
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema
    .dropTable('status_history')
    .renameTable('account_providers', 'accountProviders')
}
