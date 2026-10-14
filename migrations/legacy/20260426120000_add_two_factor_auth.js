/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.transaction(async (trx) => {
    await trx.schema.alterTable('accounts', (table) => {
      table.boolean('twoFactorEnabled').notNullable().defaultTo(false)
    })

    await trx.schema.createTable('twoFactor', (table) => {
      table.string('id').primary()
      table.text('secret').notNullable()
      table.text('backupCodes').notNullable()
      table
        .string('userId')
        .notNullable()
        .references('id')
        .inTable('accounts')
        .onDelete('CASCADE')
      table.boolean('verified').notNullable().defaultTo(false)
      table.unique(['userId'])
    })
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.transaction(async (trx) => {
    await trx.schema.dropTableIfExists('twoFactor')
    await trx.schema.alterTable('accounts', (table) => {
      table.dropColumn('twoFactorEnabled')
    })
  })
}
