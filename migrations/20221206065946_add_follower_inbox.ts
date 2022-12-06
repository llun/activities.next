import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('follows', function (table) {
    table.string('inbox')
    table.string('sharedInbox')
  })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('follows', function (table) {
    table.dropColumn('inbox')
    table.dropColumn('sharedInbox')
  })
}
