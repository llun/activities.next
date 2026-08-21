// better-auth 1.7's oauth-provider plugin widened its own schema, and the
// adapter inserts whatever the plugin puts in the record — `knexAdapter.create`
// does a bare `insert(record)` with no column filtering, so a field the plugin
// always sets and the table does not have is an outright INSERT failure.
//
// The one that bites immediately is `oauthConsent.requestedUserInfoClaims`:
// `getRequestedUserInfoClaims` answers `[]` rather than `undefined` when a
// client requests no claims, and the factory's transformInput only drops
// `undefined`. So approving consent — every OAuth sign-in, for every Mastodon
// client — failed with `table oauthConsent has no column named
// requestedUserInfoClaims` and the authorize page fell through to
// `server_error`. `oauthAccessToken`/`oauthRefreshToken.authorizationCodeId` is
// the same story one step later, at the token exchange.
//
// The rest of this migration is the remainder of the plugin's declared schema
// rather than only the fields with a known-reachable write. Which paths are
// reachable is exactly what was mis-guessed the first time, and AGENTS.md's
// rule for this adapter is that a registered plugin's tables must exist —
// `knexAdapter` creates nothing on demand. The full list is derived from
// better-auth's own `getAuthTables(auth.options)`, which
// `lib/services/auth/schemaCompleteness.test.ts` now re-derives on every run so
// the next upgrade fails a test instead of an OAuth login.
//
// Every added column is nullable: these are new optional fields on tables that
// already hold rows.

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.transaction(async (trx) => {
    await trx.schema.alterTable('oauthClient', (table) => {
      table.string('clientDiscoveryId').nullable()
      table.text('clientCredentialsScopes').nullable()
      table.string('backchannelLogoutUri').nullable()
      table.boolean('backchannelLogoutSessionRequired').nullable()
      table.string('applicationType').nullable()
      // A JWK Set document, not an identifier — `varchar(255)` would truncate
      // or reject one, so this and `rotationReplayResponse` below take `text`
      // even though better-auth types them as plain strings.
      table.text('jwks').nullable()
      table.string('jwksUri').nullable()
      table.boolean('dpopBoundAccessTokens').nullable().defaultTo(false)
    })

    await trx.schema.alterTable('oauthAccessToken', (table) => {
      table.string('authorizationCodeId').nullable()
      table.text('resources').nullable()
      table.text('requestedUserInfoClaims').nullable()
      table.timestamp('revoked', { useTz: true }).nullable()
      table.text('confirmation').nullable()
    })

    await trx.schema.alterTable('oauthRefreshToken', (table) => {
      table.string('authorizationCodeId').nullable()
      table.text('resources').nullable()
      table.text('requestedUserInfoClaims').nullable()
      table.timestamp('rotatedAt', { useTz: true }).nullable()
      table.text('rotationReplayResponse').nullable()
      table.timestamp('rotationReplayExpiresAt', { useTz: true }).nullable()
      table.text('confirmation').nullable()
    })

    await trx.schema.alterTable('oauthConsent', (table) => {
      table.text('resources').nullable()
      table.text('requestedUserInfoClaims').nullable()
    })

    // RFC 8707 resource indicators. Unused by this instance today, but the
    // plugin declares them and resolves them through the adapter.
    await trx.schema.createTable('oauthResource', (table) => {
      table.string('id').primary()
      table.string('identifier').notNullable().unique()
      table.string('name').notNullable()
      table.integer('accessTokenTtl').nullable()
      table.integer('refreshTokenTtl').nullable()
      table.string('signingAlgorithm').nullable()
      table.string('signingKeyId').nullable()
      table.text('allowedScopes').nullable()
      table.text('customClaims').nullable()
      table.boolean('dpopBoundAccessTokensRequired').nullable()
      table.boolean('disabled').nullable()
      table.integer('policyVersion').nullable()
      table.text('metadata').nullable()
      table.timestamp('createdAt', { useTz: true }).defaultTo(trx.fn.now())
      table.timestamp('updatedAt', { useTz: true }).defaultTo(trx.fn.now())
    })

    await trx.schema.createTable('oauthClientResource', (table) => {
      table.string('id').primary()
      table
        .string('clientId')
        .notNullable()
        .references('clientId')
        .inTable('oauthClient')
        .onDelete('CASCADE')
      table
        .string('resourceId')
        .notNullable()
        .references('identifier')
        .inTable('oauthResource')
        .onDelete('CASCADE')
      table.text('metadata').nullable()
      table.timestamp('createdAt', { useTz: true }).defaultTo(trx.fn.now())
    })

    // Replay protection for private_key_jwt client assertions: the row id is
    // the assertion's `jti`, which is why the table carries nothing else.
    await trx.schema.createTable('oauthClientAssertion', (table) => {
      table.string('id').primary()
      table.timestamp('expiresAt', { useTz: true }).notNullable()
    })
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.transaction(async (trx) => {
    await trx.schema.dropTableIfExists('oauthClientAssertion')
    await trx.schema.dropTableIfExists('oauthClientResource')
    await trx.schema.dropTableIfExists('oauthResource')

    await trx.schema.alterTable('oauthConsent', (table) => {
      table.dropColumn('resources')
      table.dropColumn('requestedUserInfoClaims')
    })

    await trx.schema.alterTable('oauthRefreshToken', (table) => {
      table.dropColumn('authorizationCodeId')
      table.dropColumn('resources')
      table.dropColumn('requestedUserInfoClaims')
      table.dropColumn('rotatedAt')
      table.dropColumn('rotationReplayResponse')
      table.dropColumn('rotationReplayExpiresAt')
      table.dropColumn('confirmation')
    })

    await trx.schema.alterTable('oauthAccessToken', (table) => {
      table.dropColumn('authorizationCodeId')
      table.dropColumn('resources')
      table.dropColumn('requestedUserInfoClaims')
      table.dropColumn('revoked')
      table.dropColumn('confirmation')
    })

    await trx.schema.alterTable('oauthClient', (table) => {
      table.dropColumn('clientDiscoveryId')
      table.dropColumn('clientCredentialsScopes')
      table.dropColumn('backchannelLogoutUri')
      table.dropColumn('backchannelLogoutSessionRequired')
      table.dropColumn('applicationType')
      table.dropColumn('jwks')
      table.dropColumn('jwksUri')
      table.dropColumn('dpopBoundAccessTokens')
    })
  })
}
