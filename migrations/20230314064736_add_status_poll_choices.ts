import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema
    .createTable('poll_choices', function (table) {
      table.increments('choiceId').primary()
      table.string('statusId')
      table.string('title')

      table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
      table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())
    })
    .createTable('poll_answers', function (table) {
      table.increments('answerId').primary()
      table.integer('choice').unsigned().notNullable()
      table.string('actorId').notNullable()

      table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
      table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())
    })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('poll_choices').dropTable('poll_answer')
}
