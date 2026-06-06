/**
 * Conversation (thread) mutes for the Mastodon
 * `POST /api/v1/statuses/:id/mute` + `/unmute` endpoints. A row mutes the
 * conversation identified by its thread-root status id for one actor, which
 * drives the `muted` flag on statuses and suppresses notifications for that
 * thread.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) =>
  knex.schema.createTable('status_mutes', (table) => {
    table.string('actorId').notNullable()
    // The thread-root status id that identifies the muted conversation.
    table.string('statusId').notNullable()
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    // The composite primary key (actorId, statusId) already serves
    // actorId-prefix lookups (e.g. getActorMutedConversationRootIds), so no
    // separate actorId index is needed.
    table.primary(['actorId', 'statusId'])
    table.index(['statusId'], 'status_mutes_status')
  })

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => knex.schema.dropTable('status_mutes')
