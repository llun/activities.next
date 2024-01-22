/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) => {
  return knex.schema.alterTable('accounts', function (table) {
    table.string('verificationCode')
    table.boolean('verifiedAt')

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
