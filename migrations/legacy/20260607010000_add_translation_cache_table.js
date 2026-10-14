/**
 * Cache of translated strings for `POST /api/v1/statuses/:id/translate`.
 * Keyed by the active provider, the source language, the target language, and a
 * hash of the source string so the same text translated to the same language
 * (even across different statuses) hits the backend only once. The
 * `sourceLanguage` is part of the key so identical text declared in different
 * languages (e.g. "gift" in English vs German) never shares a translation. The
 * `provider` column folds in the LLM model id, so switching models does not
 * serve stale translations.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = (knex) =>
  knex.schema.createTable('translation_cache', (table) => {
    // Columns are sized so the 4-column composite primary key stays within
    // MySQL's 3072-byte index limit (191 + 16 + 16 + 64 chars). `sourceHash` is
    // a fixed 64-char sha256 hex digest; the language codes are ISO 639-1.
    table.string('provider', 191).notNullable()
    table.string('sourceLanguage', 16).notNullable()
    table.string('targetLanguage', 16).notNullable()
    table.string('sourceHash', 64).notNullable()
    table.text('content').notNullable()
    table.string('detectedSourceLanguage', 16)
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())

    table.primary([
      'provider',
      'sourceLanguage',
      'targetLanguage',
      'sourceHash'
    ])
    // Indexed so expiry sweeps by createdAt stay efficient.
    table.index(['createdAt'], 'translation_cache_created')
  })

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = (knex) => knex.schema.dropTable('translation_cache')
