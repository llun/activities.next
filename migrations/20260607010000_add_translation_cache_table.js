/**
 * Cache of translated strings for `POST /api/v1/statuses/:id/translate`.
 * Keyed by the active provider, the target language, and a hash of the source
 * string so the same text translated to the same language (even across
 * different statuses) hits the backend only once. The `provider` column folds
 * in the LLM model id, so switching models does not serve stale translations.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) =>
  knex.schema.createTable('translation_cache', (table) => {
    table.string('provider').notNullable()
    table.string('targetLanguage').notNullable()
    table.string('sourceHash').notNullable()
    table.text('content').notNullable()
    table.string('detectedSourceLanguage')
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())

    table.primary(['provider', 'targetLanguage', 'sourceHash'])
    // Indexed so expiry sweeps by createdAt stay efficient.
    table.index(['createdAt'], 'translation_cache_created')
  })

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => knex.schema.dropTable('translation_cache')
