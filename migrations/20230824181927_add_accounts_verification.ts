import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('accounts', function (table) {
    table.string('verificationCode')
    table.boolean('verifiedAt')

    table.index('verificationCode', 'verificationCodeIndex')
  })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('accounts', function (table) {
    table.dropIndex('verificationCode', 'verificationCodeIndex')
    table.dropColumns('verificationCode', 'verifiedAt')
  })
}
