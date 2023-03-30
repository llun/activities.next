import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('poll_choices', function (table) {
    table.integer('totalVotes').unsigned().notNullable().defaultTo(0)
  })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('poll_choices', function (table) {
    table.dropColumn('totalVotes')
  })
}
