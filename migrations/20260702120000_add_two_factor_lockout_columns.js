/**
 * better-auth's two-factor plugin (>= 1.6.x) adds account-lockout tracking to
 * the `twoFactor` table: it increments `failedVerificationCount` on each failed
 * verification and sets `lockedUntil` once the budget is spent. The original
 * `twoFactor` migration predates those fields, so enabling 2FA and verifying a
 * code both fail with `table twoFactor has no column named
 * failedVerificationCount`. Add the columns the plugin schema now expects.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.schema.alterTable('twoFactor', (table) => {
    table.integer('failedVerificationCount').notNullable().defaultTo(0)
    table.dateTime('lockedUntil').nullable()
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.schema.alterTable('twoFactor', (table) => {
    table.dropColumn('failedVerificationCount')
    table.dropColumn('lockedUntil')
  })
}
