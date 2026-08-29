/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  // `accounts.verifiedAt` originally carried DEFAULT CURRENT_TIMESTAMP
  // (20230824181927_add_accounts_verification), causing pending registrations
  // to be stamped with now() if the column was omitted on insert.
  // Drop the column default so omitted values default to NULL.
  await knex.schema.alterTable('accounts', function (table) {
    table.timestamp('verifiedAt', { useTz: true }).nullable().alter()
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  await knex.schema.alterTable('accounts', function (table) {
    table
      .timestamp('verifiedAt', { useTz: true })
      .defaultTo(knex.fn.now())
      .alter()
  })
}
