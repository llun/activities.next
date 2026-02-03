/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .createTable('fitness_settings', function (table) {
      table.string('id').primary()
      table.string('actorId').notNullable()
      table.foreign('actorId').references('id').inTable('actors')
      table.string('serviceType').notNullable()

      // OAuth credentials (nullable, only for services that need them)
      table.string('clientId')
      table.text('clientSecret') // Encrypted

      // Webhook
      table.string('webhookToken')

      // OAuth tokens (encrypted)
      table.text('accessToken')
      table.text('refreshToken')
      table.timestamp('tokenExpiresAt', { useTz: true })

      // OAuth flow state (temporary)
      table.string('oauthState')
      table.timestamp('oauthStateExpiry', { useTz: true })

      // Standard timestamps
      table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
      table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())
      table.timestamp('deletedAt', { useTz: true })

      // One connection per service per actor (only for non-deleted rows)
      // Note: This unique constraint won't prevent re-creation after soft delete
      // in PostgreSQL, but will in SQLite. For full support, we'd need a partial index.
      // For now, we'll enforce uniqueness only on non-deleted rows at the application level.
      table.index(
        ['actorId', 'serviceType', 'deletedAt'],
        'fitness_settings_idx'
      )
    })
    .then(() => {
      // Add partial unique index for non-deleted rows
      // SQLite: CREATE UNIQUE INDEX ... WHERE deletedAt IS NULL
      // PostgreSQL: Same syntax
      return knex.raw(
        'CREATE UNIQUE INDEX fitness_settings_unique_active ON fitness_settings(actorId, serviceType) WHERE deletedAt IS NULL'
      )
    })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('fitness_settings')
}
