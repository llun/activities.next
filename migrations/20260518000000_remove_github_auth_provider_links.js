/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async (knex) => {
  await knex('account_providers').where({ provider: 'github' }).delete()
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async () => {
  // GitHub provider links cannot be restored after removal.
}
