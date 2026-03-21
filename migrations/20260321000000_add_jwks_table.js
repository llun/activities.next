/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async (knex) => {
  await knex.schema.createTable('jwks', (table) => {
    table.string('id').primary()
    table.text('publicKey').notNullable()
    table.text('privateKey').notNullable()
    table.timestamp('createdAt', { useTz: true }).notNullable()
    table.timestamp('expiresAt', { useTz: true }).nullable()
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('jwks')
}
