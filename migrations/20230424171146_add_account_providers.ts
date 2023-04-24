import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('accountProviders', function (table) {
    table.string('id').primary()
    table.string('accountId')
    table.string('provider')
    table.string('providerId')

    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.index(
      ['accountId', 'provider', 'providerId'],
      'accountProvidersIndex'
    )
  })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('accountProviders')
}
