/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.alterTable('accounts', function (table) {
    table.string('passwordResetCode')
    table.timestamp('passwordResetCodeExpiresAt', { useTz: true })

    table.index('passwordResetCode', 'passwordResetCodeIndex')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('accounts', function (table) {
    table.dropIndex('passwordResetCode', 'passwordResetCodeIndex')
    table.dropColumn('passwordResetCode')
    table.dropColumn('passwordResetCodeExpiresAt')
  })
}
