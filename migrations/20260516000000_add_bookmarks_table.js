/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) =>
  knex.schema.createTable('bookmarks', (table) => {
    table.bigIncrements('id').primary()
    table.string('actorId').notNullable()
    table.string('statusId').notNullable()
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.unique(['actorId', 'statusId'], {
      indexName: 'bookmarks_actor_status_unique'
    })
    table.index(['actorId', 'createdAt', 'id'], 'bookmarks_actor_created_id')
    table.index(['statusId'], 'bookmarks_status')
  })

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => knex.schema.dropTable('bookmarks')
