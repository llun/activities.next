/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async (knex) => {
  await knex.transaction(async (trx) => {
    await trx.schema.alterTable('accounts', (table) => {
      table.boolean('twoFactorEnabled').notNullable().defaultTo(false)
    })

    await trx.schema.createTable('twoFactor', (table) => {
      table.string('id').primary()
      table.text('secret').notNullable().index()
      table.text('backupCodes').notNullable()
      table
        .string('userId')
        .notNullable()
        .references('id')
        .inTable('accounts')
        .onDelete('CASCADE')
      table.boolean('verified').notNullable().defaultTo(true)
      table.unique(['userId'])
      table.index(['userId'])
    })
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async (knex) => {
  await knex.transaction(async (trx) => {
    await trx.schema.dropTableIfExists('twoFactor')
    await trx.schema.alterTable('accounts', (table) => {
      table.dropColumn('twoFactorEnabled')
    })
  })
}
