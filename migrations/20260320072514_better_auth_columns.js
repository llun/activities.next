/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async (knex) => {
  await knex.transaction(async (trx) => {
    // Add columns needed by better-auth to account_providers table
    await trx.schema.alterTable('account_providers', (table) => {
      table.text('password').nullable()
      table.text('accessToken').nullable()
      table.text('refreshToken').nullable()
      table.text('idToken').nullable()
      table.timestamp('accessTokenExpiresAt').nullable()
      table.timestamp('refreshTokenExpiresAt').nullable()
      table.text('scope').nullable()
    })

    // Add name and image columns to accounts (user) table
    await trx.schema.alterTable('accounts', (table) => {
      table.string('name').nullable()
      table.text('image').nullable()
      table.boolean('emailVerified').defaultTo(false)
    })

    // Populate emailVerified from verifiedAt
    await trx('accounts')
      .whereNotNull('verifiedAt')
      .update({ emailVerified: true })

    // Create credential provider entries for existing users with passwords
    const accountsWithPasswords = await trx('accounts')
      .whereNotNull('passwordHash')
      .select('id', 'passwordHash')

    const existingCredentials = await trx('account_providers')
      .where('provider', 'credential')
      .whereIn(
        'accountId',
        accountsWithPasswords.map((a) => a.id)
      )
      .select('accountId')
    const existingSet = new Set(existingCredentials.map((c) => c.accountId))

    const rowsToInsert = accountsWithPasswords
      .filter((account) => !existingSet.has(account.id))
      .map((account) => ({
        id: `credential_${account.id}`,
        accountId: account.id,
        provider: 'credential',
        providerId: account.id,
        password: account.passwordHash,
        createdAt: trx.fn.now(),
        updatedAt: trx.fn.now()
      }))

    if (rowsToInsert.length > 0) {
      await trx.batchInsert('account_providers', rowsToInsert, 100)
    }
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async (knex) => {
  await knex.transaction(async (trx) => {
    // Remove credential provider entries
    await trx('account_providers').where({ provider: 'credential' }).delete()

    await trx.schema.alterTable('accounts', (table) => {
      table.dropColumn('name')
      table.dropColumn('image')
      table.dropColumn('emailVerified')
    })

    await trx.schema.alterTable('account_providers', (table) => {
      table.dropColumn('password')
      table.dropColumn('accessToken')
      table.dropColumn('refreshToken')
      table.dropColumn('idToken')
      table.dropColumn('accessTokenExpiresAt')
      table.dropColumn('refreshTokenExpiresAt')
      table.dropColumn('scope')
    })
  })
}
