/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) => {
  return knex.schema.createTable('bookmarks', function (table) {
    table.string('id').primary()
    table.string('actorId').notNullable()
    table.string('statusId').notNullable()

    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.unique(['actorId', 'statusId'])
    table.index(['actorId', 'createdAt', 'id'])
    table.index(['statusId'])
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => {
  return knex.schema.dropTable('bookmarks')
}
