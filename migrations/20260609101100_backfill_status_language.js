/**
 * Best-effort backfill for the per-status `language` field on already-ingested
 * federated statuses.
 *
 * Federated posts ingested over ActivityPub historically stored `language: null`
 * inside the status `content` JSON blob, so the per-status Translate control
 * never appears on them. New ingestions now derive the language from the
 * incoming Note's `contentMap`/`summaryMap` key (see
 * `getLanguage` in `lib/activities/note.ts`).
 *
 * For existing rows there is nothing to recover: the persisted content blob
 * keeps only the rendered `{ url, text, summary, sensitive, language }` fields —
 * it does NOT retain the original AP object's `contentMap`, which is the only
 * place the source language was encoded. We deliberately do not guess the
 * language from the stored HTML text (that would invent data), so this
 * migration is an intentional no-op and existing rows keep `language: null`
 * until the status is re-fetched or federated again with its `contentMap`.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function () {
  // Intentional no-op: the original AP `contentMap` is not persisted, so the
  // source language of historical federated statuses cannot be recovered.
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function () {
  // Nothing to undo: the up migration does not modify any data.
}
