import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('accounts', function (table) {
    table.string('passwordHash')
  })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('accounts', function (table) {
    table.dropColumn('passwordHash')
  })
}
