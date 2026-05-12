/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async (knex) => {
  await knex('oauthClient')
    .where((builder) => {
      builder.whereNull('requirePKCE').orWhere('requirePKCE', false)
    })
    .update({ requirePKCE: true })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async () => {
  // Intentionally not reversible: disabling PKCE for existing OAuth clients
  // would reintroduce the authorization-code hardening gap.
}
