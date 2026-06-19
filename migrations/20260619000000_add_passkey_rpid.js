/**
 * Adds the WebAuthn rpID (relying party / domain) a passkey was created against.
 * An instance can serve several domains (ACTIVITIES_HOST + ACTIVITIES_TRUSTED_HOSTS)
 * and a WebAuthn credential is bound to the origin it was created on, so storing
 * the rpID lets the settings page show which domain each passkey belongs to.
 * Nullable so existing rows (all created on the primary host) keep working; the
 * listing maps a null rpID to the configured host.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.schema.alterTable('passkey', (table) => {
    table.string('rpID').nullable()
    table.index(['userId', 'rpID'])
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.schema.alterTable('passkey', (table) => {
    table.dropIndex(['userId', 'rpID'])
    table.dropColumn('rpID')
  })
}
