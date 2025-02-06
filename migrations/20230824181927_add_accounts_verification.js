/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) => {
  return knex.schema.alterTable('accounts', function (table) {
    table.string('verificationCode')
    table.timestamp('verifiedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.index('verificationCode', 'verificationCodeIndex')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => {
  return knex.schema.alterTable('accounts', function (table) {
    table.dropIndex('verificationCode', 'verificationCodeIndex')
    table.dropColumns('verificationCode', 'verifiedAt')
  })
}
