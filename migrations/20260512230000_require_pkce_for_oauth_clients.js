// WARNING: This migration unconditionally enables requirePKCE for all
// existing OAuth clients. Any client that does not support PKCE will stop
// being able to exchange authorization codes after this migration runs.
// The change is intentionally irreversible (down() is a no-op).

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
