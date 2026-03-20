/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async (knex) => {
  await knex.schema.createTable('verification', (table) => {
    table.text('id').primary()
    table.text('identifier').notNullable()
    table.text('value').notNullable()
    table.timestamp('expiresAt').notNullable()
    table.timestamp('createdAt').nullable()
    table.timestamp('updatedAt').nullable()
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async (knex) => {
  await knex.schema.dropTable('verification')
}
