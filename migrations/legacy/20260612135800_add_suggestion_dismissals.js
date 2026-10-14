/**
 * Stores follow suggestions an actor has dismissed (Mastodon's "follow
 * suggestions"). Backs the DELETE /api/v1/suggestions/:account_id endpoint
 * and lets GET /api/v1/suggestions and GET /api/v2/suggestions exclude
 * accounts the actor has already removed from their suggestions.
 *
 * `actorId` is the dismissing actor and `targetActorId` is the suggested
 * account being dismissed; the composite primary key keeps one dismissal
 * row per (actor, target) pair and makes repeat dismissals idempotent.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.schema.createTable('suggestion_dismissals', (table) => {
    table.string('actorId').notNullable()
    table.string('targetActorId').notNullable()
    table.timestamp('createdAt').notNullable()
    table.primary(['actorId', 'targetActorId'])
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.schema.dropTableIfExists('suggestion_dismissals')
}
