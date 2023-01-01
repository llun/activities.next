import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('tags', function (table) {
    table.string('id').primary()
    table.string('statusId')

    table.string('type')
    table.string('name')

    // For mention, this is href
    table.string('value')

    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.index(['statusId', 'type', 'createdAt', 'updatedAt'], 'tagsIndex')
  })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('tags')
}
