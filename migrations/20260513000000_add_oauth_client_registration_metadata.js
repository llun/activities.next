/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async (knex) => {
  await knex.transaction(async (trx) => {
    const hasReferenceId = await trx.schema.hasColumn(
      'oauthClient',
      'referenceId'
    )
    const hasMetadata = await trx.schema.hasColumn('oauthClient', 'metadata')

    if (!hasReferenceId) {
      await trx.schema.alterTable('oauthClient', (table) => {
        table.string('referenceId').nullable()
      })
    }

    if (!hasMetadata) {
      await trx.schema.alterTable('oauthClient', (table) => {
        table.text('metadata').nullable()
      })
    }
  })
}

/**
 * @returns { Promise<void> }
 */
exports.down = async () => {
  // Intentionally no-op: fresh databases may already have these columns from
  // the OAuth provider table migration, and current app code depends on them.
}
