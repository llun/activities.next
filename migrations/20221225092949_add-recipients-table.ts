import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('recipients', function (table) {
    table.string('id').primary()
    table.string('statusId')
    // as:Public or actorId
    table.string('actorId')
    // Type: to, cc or local
    table.string('type')

    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.index(
      ['statusId', 'type', 'createdAt', 'updatedAt'],
      'recipientsIndex'
    )
  })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('recipients')
}
