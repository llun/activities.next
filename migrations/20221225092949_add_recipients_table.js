/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) => {
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

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => {
  return knex.schema.dropTable('recipients')
}
