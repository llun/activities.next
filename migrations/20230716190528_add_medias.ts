import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('medias', function (table) {
    table.increments('id').primary()
    table.string('actorId')
    table.string('original')
    table.string('thumbnail').nullable()
    table.string('description').nullable()

    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())
  })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('medias')
}
