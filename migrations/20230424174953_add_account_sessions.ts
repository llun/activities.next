import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('sessions', function (table) {
    table.string('id').primary()
    table.string('accountId')
    table.string('token')

    table.timestamp('expireAt', { useTz: true })

    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.index(['accountId', 'token'], 'sessionTokenIndex')
  })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('sessions')
}
