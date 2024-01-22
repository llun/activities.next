/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) => {
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

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => {
  return knex.schema.dropTable('tags')
}
