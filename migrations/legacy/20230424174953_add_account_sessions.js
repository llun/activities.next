/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = (knex) => {
  return knex.schema.createTable('sessions', function (table) {
    table.string('id').primary()
    table.string('accountId')
    table.string('token')

    table.timestamp('expireAt', { useTz: true })

    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.index(['accountId', 'token'], 'sessionTokenIndex')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = (knex) => {
  return knex.schema.dropTable('sessions')
}
