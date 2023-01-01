import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('statuses', function (table) {
    table.text('content')
  })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('actors', function (table) {
    table.dropColumn('settings')
  })
}
