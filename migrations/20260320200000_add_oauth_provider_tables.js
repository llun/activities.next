const crypto = require('crypto')

const hashClientSecret = (secret) => {
  const hash = crypto.createHash('sha256').update(secret).digest()
  return hash
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async (knex) => {
  await knex.transaction(async (trx) => {
    // Create oauthClient table for better-auth oauth-provider plugin
    await trx.schema.createTable('oauthClient', (table) => {
      table.string('id').primary()
      table.string('clientId').unique().notNullable()
      table.text('clientSecret').nullable()
      table.boolean('disabled').defaultTo(false)
      table.boolean('skipConsent').nullable()
      table.boolean('enableEndSession').nullable()
      table.string('subjectType').nullable()
      table.text('scopes').nullable()
      table.string('userId').nullable().references('id').inTable('accounts')
      table.string('name').nullable()
      table.string('uri').nullable()
      table.string('icon').nullable()
      table.text('contacts').nullable()
      table.string('tos').nullable()
      table.string('policy').nullable()
      table.string('softwareId').nullable()
      table.string('softwareVersion').nullable()
      table.text('softwareStatement').nullable()
      table.text('redirectUris').notNullable()
      table.text('postLogoutRedirectUris').nullable()
      table.string('tokenEndpointAuthMethod').nullable()
      table.text('grantTypes').nullable()
      table.text('responseTypes').nullable()
      table.boolean('public').nullable()
      table.string('type').nullable()
      table.boolean('requirePKCE').nullable()
      table.string('referenceId').nullable()
      table.text('metadata').nullable()
      table.timestamp('createdAt', { useTz: true }).defaultTo(trx.fn.now())
      table.timestamp('updatedAt', { useTz: true }).defaultTo(trx.fn.now())
    })

    // Create oauthRefreshToken table
    await trx.schema.createTable('oauthRefreshToken', (table) => {
      table.string('id').primary()
      table.text('token').notNullable().unique()
      table
        .string('clientId')
        .notNullable()
        .references('clientId')
        .inTable('oauthClient')
      table.string('sessionId').nullable().references('id').inTable('sessions')
      table.string('userId').notNullable().references('id').inTable('accounts')
      table.string('referenceId').nullable()
      table.timestamp('expiresAt', { useTz: true }).notNullable()
      table.timestamp('revoked', { useTz: true }).nullable()
      table.timestamp('authTime', { useTz: true }).nullable()
      table.text('scopes').notNullable()
      table.timestamp('createdAt', { useTz: true }).defaultTo(trx.fn.now())
    })

    // Create oauthAccessToken table
    await trx.schema.createTable('oauthAccessToken', (table) => {
      table.string('id').primary()
      table.text('token').notNullable().unique()
      table
        .string('clientId')
        .notNullable()
        .references('clientId')
        .inTable('oauthClient')
      table.string('sessionId').nullable().references('id').inTable('sessions')
      table.string('userId').nullable().references('id').inTable('accounts')
      table.string('referenceId').nullable()
      table
        .string('refreshId')
        .nullable()
        .references('id')
        .inTable('oauthRefreshToken')
      table.timestamp('expiresAt', { useTz: true }).notNullable()
      table.text('scopes').notNullable()
      table.timestamp('createdAt', { useTz: true }).defaultTo(trx.fn.now())
    })

    // Create oauthConsent table
    await trx.schema.createTable('oauthConsent', (table) => {
      table.string('id').primary()
      table
        .string('clientId')
        .notNullable()
        .references('clientId')
        .inTable('oauthClient')
      table.string('userId').nullable().references('id').inTable('accounts')
      table.string('referenceId').nullable()
      table.text('scopes').notNullable()
      table.timestamp('createdAt', { useTz: true }).defaultTo(trx.fn.now())
      table.timestamp('updatedAt', { useTz: true }).defaultTo(trx.fn.now())
    })

    // Migrate existing clients from 'clients' table to 'oauthClient'
    const existingClients = await trx('clients').select('*')
    for (const client of existingClients) {
      const scopes =
        typeof client.scopes === 'string'
          ? JSON.parse(client.scopes)
          : client.scopes
      // Normalize scopes: the old @jmondi/oauth2-server model transformed
      // plain strings to { name: 'read' } objects at read time, but the DB
      // stored them as plain strings. Handle both formats defensively.
      const normalizedScopes = Array.isArray(scopes)
        ? scopes.map((s) => (typeof s === 'object' && s !== null ? s.name : s))
        : scopes
      const redirectUris =
        typeof client.redirectUris === 'string'
          ? JSON.parse(client.redirectUris)
          : client.redirectUris

      await trx('oauthClient').insert({
        id: crypto.randomUUID(),
        clientId: client.id,
        clientSecret: client.secret ? hashClientSecret(client.secret) : null,
        name: client.name,
        scopes: JSON.stringify(normalizedScopes),
        redirectUris: JSON.stringify(redirectUris),
        uri: client.website || null,
        requirePKCE: false,
        disabled: false,
        grantTypes: JSON.stringify([
          'authorization_code',
          'client_credentials',
          'refresh_token'
        ]),
        responseTypes: JSON.stringify(['code']),
        tokenEndpointAuthMethod: 'client_secret_post',
        createdAt: client.createdAt || trx.fn.now(),
        updatedAt: client.updatedAt || trx.fn.now()
      })
    }
  })
}

/**
 * WARNING: This rollback is destructive. Dropping the oauthClient table will
 * permanently delete all OAuth client registrations and associated tokens.
 * Data migrated from the legacy 'clients' table cannot be recovered.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async (knex) => {
  await knex.transaction(async (trx) => {
    await trx.schema.dropTableIfExists('oauthConsent')
    await trx.schema.dropTableIfExists('oauthAccessToken')
    await trx.schema.dropTableIfExists('oauthRefreshToken')
    await trx.schema.dropTableIfExists('oauthClient')
  })
}
