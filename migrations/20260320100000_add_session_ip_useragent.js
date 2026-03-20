/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async (knex) => {
  await knex.transaction(async (trx) => {
    await trx.schema.alterTable('sessions', (table) => {
      table.text('ipAddress').nullable()
      table.text('userAgent').nullable()
    })
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async (knex) => {
  await knex.transaction(async (trx) => {
    await trx.schema.alterTable('sessions', (table) => {
      table.dropColumn('ipAddress')
      table.dropColumn('userAgent')
    })
  })
}
