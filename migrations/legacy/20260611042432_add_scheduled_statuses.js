/**
 * Stores statuses an actor has scheduled for future publication (Mastodon's
 * "scheduled statuses"). Backs the REST endpoints (GET /api/v1/scheduled_statuses,
 * GET/PUT/DELETE /scheduled_statuses/:id) and the background publish job that
 * promotes a row into a real status once `scheduledAt` is due.
 *
 * `params` is the serialized Mastodon "params" payload (text, spoiler_text,
 * visibility, sensitive, language, in_reply_to_id, media_ids, poll,
 * idempotency, application_id) stored as JSON text so it works on both
 * SQLite and Postgres. `actorId` is indexed for owner-scoped listing and
 * `scheduledAt` for the due-query the publish job runs across all actors.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.schema.createTable('scheduled_statuses', (table) => {
    table.string('id').primary()
    table.string('actorId').notNullable().index()
    table.timestamp('scheduledAt').notNullable().index()
    // Serialized Mastodon "params" payload: text, spoiler_text, visibility,
    // sensitive, language, in_reply_to_id, media_ids, poll, idempotency,
    // application_id.
    table.text('params').notNullable()
    table.timestamp('createdAt').notNullable()
    table.timestamp('updatedAt').notNullable()
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.schema.dropTableIfExists('scheduled_statuses')
}
