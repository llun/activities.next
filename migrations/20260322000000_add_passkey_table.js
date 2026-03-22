/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async (knex) => {
  await knex.schema.createTable('passkey', (table) => {
    table.string('id').primary()
    table.string('name').nullable()
    table.text('publicKey').notNullable()
    table
      .string('userId')
      .notNullable()
      .references('id')
      .inTable('accounts')
      .onDelete('CASCADE')
    table.string('credentialID').notNullable()
    table.integer('counter').notNullable().defaultTo(0)
    table.string('deviceType').notNullable()
    table.boolean('backedUp').notNullable().defaultTo(false)
    table.string('transports').nullable()
    table.string('aaguid').nullable()
    table
      .timestamp('createdAt', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now())
    table.index(['userId'])
    table.index(['credentialID'])
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('passkey')
}
