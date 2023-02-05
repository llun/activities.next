import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('timelines', function (table) {
    table.string('actorId')
    table.string('timeline')
    table.string('statusId')

    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.primary(['actorId', 'timeline', 'statusId'])
  })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('timelines')
}
