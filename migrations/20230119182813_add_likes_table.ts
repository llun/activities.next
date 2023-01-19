import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('likes', function (table) {
    table.string('statusId')
    table.string('actorId')

    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.primary(['statusId', 'actorId'])
  })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('likes')
}
