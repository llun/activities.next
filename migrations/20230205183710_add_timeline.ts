import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('timelines', function (table) {
    table.increments('id').primary()
    table.string('actorId')
    table.string('timeline')
    table.string('statusId')
    table.string('statusActorId')

    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.unique(['actorId', 'timeline', 'statusId'], {
      indexName: 'actor_timeline_status'
    })
  })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('timelines')
}
