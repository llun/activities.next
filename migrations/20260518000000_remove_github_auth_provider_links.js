/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex('account_providers').where({ provider: 'github' }).delete()
}

/**
 * @returns { Promise<void> }
 */
export const down = async () => {
  // GitHub provider links cannot be restored after removal.
}
