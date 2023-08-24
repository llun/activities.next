import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('accounts', function (table) {
    table.string('verificationCode')
    table.boolean('verifiedAt')
  })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('accounts', function (table) {
    table.dropColumns('verificationCode', 'verifiedAt')
  })
}
