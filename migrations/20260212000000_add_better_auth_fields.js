/**
 * Migration: Add Better Auth Required Fields
 * 
 * This migration adds the necessary fields to support Better Auth while
 * maintaining backward compatibility with the existing schema.
 * 
 * Changes:
 * - accounts table: Add 'name' and 'image' fields for Better Auth user model
 * - sessions table: Add 'ipAddress' and 'userAgent' for Better Auth session tracking
 * - accountProviders table: Add OAuth token fields for Better Auth account model
 * - New 'verification' table for email verification and password reset tokens
 * 
 * Note: This migration does NOT rename existing columns to avoid breaking changes.
 * Field mapping will be handled in the custom Better Auth adapter.
 * 
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  // 1. Add Better Auth fields to accounts table
  await knex.schema.alterTable('accounts', function (table) {
    // Better Auth expects 'name' field for user display name
    table.string('name').nullable()
    
    // Better Auth expects 'image' field for user profile picture
    table.string('image').nullable()
  })

  // 2. Add Better Auth fields to sessions table
  await knex.schema.alterTable('sessions', function (table) {
    // Better Auth tracks IP address for security
    table.string('ipAddress').nullable()
    
    // Better Auth tracks user agent for security and device management
    table.string('userAgent').nullable()
  })

  // 3. Add OAuth token fields to accountProviders table
  await knex.schema.alterTable('accountProviders', function (table) {
    // OAuth access token from provider
    table.text('accessToken').nullable()
    
    // OAuth refresh token from provider
    table.text('refreshToken').nullable()
    
    // When the access token expires
    table.timestamp('accessTokenExpiresAt', { useTz: true }).nullable()
    
    // When the refresh token expires
    table.timestamp('refreshTokenExpiresAt', { useTz: true }).nullable()
    
    // OpenID Connect ID token
    table.text('idToken').nullable()
    
    // OAuth scopes granted
    table.string('scope').nullable()
    
    // Password hash for credentials provider (if using account table for passwords)
    table.text('password').nullable()
  })

  // 4. Create verification table for Better Auth
  await knex.schema.createTable('verification', function (table) {
    table.string('id').primary()
    
    // Email or phone number being verified
    table.string('identifier').notNullable()
    
    // Verification token or code
    table.string('value').notNullable()
    
    // When this verification token expires
    table.timestamp('expiresAt', { useTz: true }).notNullable()
    
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    // Index for fast lookups
    table.index(['identifier', 'value'], 'verificationIndex')
    table.index(['expiresAt'], 'verificationExpiresAtIndex')
  })

  // 5. Populate 'name' field from actors table where it's null
  // If no actor exists, use the email as the name
  await knex.raw(`
    UPDATE accounts 
    SET name = COALESCE(
      (SELECT actors.name 
       FROM actors 
       WHERE actors.accountId = accounts.id 
       LIMIT 1),
      accounts.email
    )
    WHERE name IS NULL
  `)

  // 6. Migrate existing verification codes to verification table
  // This moves verificationCode from accounts to the new verification table
  const accountsWithCodes = await knex('accounts')
    .select('id', 'email', 'verificationCode', 'createdAt', 'updatedAt')
    .whereNotNull('verificationCode')

  if (accountsWithCodes.length > 0) {
    const verificationRecords = accountsWithCodes.map((account) => ({
      id: `${account.id}-verify-email`,
      identifier: account.email,
      value: account.verificationCode,
      expiresAt: knex.raw('NOW() + INTERVAL \'24 hours\''),
      createdAt: account.createdAt,
      updatedAt: account.updatedAt
    }))

    // Insert in batches to avoid large queries
    for (let i = 0; i < verificationRecords.length; i += 100) {
      const batch = verificationRecords.slice(i, i + 100)
      await knex('verification').insert(batch)
    }
  }

  // 7. Migrate existing password reset codes to verification table
  const accountsWithResetCodes = await knex('accounts')
    .select(
      'id',
      'email',
      'passwordResetCode',
      'passwordResetCodeExpiresAt',
      'createdAt',
      'updatedAt'
    )
    .whereNotNull('passwordResetCode')

  if (accountsWithResetCodes.length > 0) {
    const resetRecords = accountsWithResetCodes.map((account) => ({
      id: `${account.id}-reset-password`,
      identifier: account.email,
      value: account.passwordResetCode,
      expiresAt: account.passwordResetCodeExpiresAt,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt
    }))

    // Insert in batches
    for (let i = 0; i < resetRecords.length; i += 100) {
      const batch = resetRecords.slice(i, i + 100)
      await knex('verification').insert(batch)
    }
  }
}

/**
 * Rollback migration
 * 
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  // Drop verification table
  await knex.schema.dropTableIfExists('verification')

  // Remove fields from accountProviders
  await knex.schema.alterTable('accountProviders', function (table) {
    table.dropColumn('password')
    table.dropColumn('scope')
    table.dropColumn('idToken')
    table.dropColumn('refreshTokenExpiresAt')
    table.dropColumn('accessTokenExpiresAt')
    table.dropColumn('refreshToken')
    table.dropColumn('accessToken')
  })

  // Remove fields from sessions
  await knex.schema.alterTable('sessions', function (table) {
    table.dropColumn('userAgent')
    table.dropColumn('ipAddress')
  })

  // Remove fields from accounts
  await knex.schema.alterTable('accounts', function (table) {
    table.dropColumn('image')
    table.dropColumn('name')
  })
}
