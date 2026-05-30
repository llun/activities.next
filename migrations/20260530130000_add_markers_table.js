/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) =>
  knex.schema.createTable('markers', (table) => {
    table.string('id').primary()
    table.string('actorId').notNullable()
    table.string('timeline').notNullable()
    table.string('lastReadId').notNullable()
    table.integer('version').notNullable().defaultTo(1)
    table
      .timestamp('updatedAt', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now())

    table.unique(['actorId', 'timeline'], {
      indexName: 'markers_actor_timeline_unique'
    })
  })

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => knex.schema.dropTable('markers')
