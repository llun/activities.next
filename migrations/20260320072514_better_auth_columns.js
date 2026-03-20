/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async (knex) => {
  // Add columns needed by better-auth to account_providers table
  await knex.schema.alterTable('account_providers', (table) => {
    table.text('password').nullable()
    table.text('accessToken').nullable()
    table.text('refreshToken').nullable()
    table.text('idToken').nullable()
    table.timestamp('accessTokenExpiresAt', { useTz: true }).nullable()
    table.timestamp('refreshTokenExpiresAt', { useTz: true }).nullable()
    table.text('scope').nullable()
  })

  // Add name and image columns to accounts (user) table
  await knex.schema.alterTable('accounts', (table) => {
    table.string('name').nullable()
    table.text('image').nullable()
    table.boolean('emailVerified').defaultTo(false)
  })

  // Populate emailVerified from verifiedAt
  await knex('accounts')
    .whereNotNull('verifiedAt')
    .update({ emailVerified: true })

  // Create credential provider entries for existing users with passwords
  const accountsWithPasswords = await knex('accounts')
    .whereNotNull('passwordHash')
    .select('id', 'passwordHash')

  for (const account of accountsWithPasswords) {
    const existingCredential = await knex('account_providers')
      .where({ accountId: account.id, provider: 'credential' })
      .first()

    if (!existingCredential) {
      const id = `credential_${account.id}`
      await knex('account_providers').insert({
        id,
        accountId: account.id,
        provider: 'credential',
        providerId: account.id,
        password: account.passwordHash,
        createdAt: knex.fn.now(),
        updatedAt: knex.fn.now()
      })
    }
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async (knex) => {
  // Remove credential provider entries
  await knex('account_providers').where({ provider: 'credential' }).delete()

  await knex.schema.alterTable('accounts', (table) => {
    table.dropColumn('name')
    table.dropColumn('image')
    table.dropColumn('emailVerified')
  })

  await knex.schema.alterTable('account_providers', (table) => {
    table.dropColumn('password')
    table.dropColumn('accessToken')
    table.dropColumn('refreshToken')
    table.dropColumn('idToken')
    table.dropColumn('accessTokenExpiresAt')
    table.dropColumn('refreshTokenExpiresAt')
    table.dropColumn('scope')
  })
}
