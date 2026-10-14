/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = function (knex) {
  return knex.schema.alterTable('accounts', function (table) {
    table.string('emailChangePending')
    table.string('emailChangeCode')
    table.timestamp('emailChangeCodeExpiresAt', { useTz: true })
    table.timestamp('emailVerifiedAt', { useTz: true })
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = function (knex) {
  return knex.schema.alterTable('accounts', function (table) {
    table.dropColumn('emailChangePending')
    table.dropColumn('emailChangeCode')
    table.dropColumn('emailChangeCodeExpiresAt')
    table.dropColumn('emailVerifiedAt')
  })
}
