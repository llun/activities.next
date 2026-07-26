/**
 * Capability tokens that make a mention/reply notification email repliable.
 *
 * Each row binds one token to exactly one (actor, status) pair: the actor
 * allowed to post and the status the reply threads under. The token itself is
 * never stored — only `tokenHash`, an HMAC-SHA256 keyed with the server secret
 * (see lib/services/email/replyToken.ts) — so a database leak cannot be turned
 * into a working reply address.
 *
 * Rows are reusable rather than single-use: people legitimately reply twice to
 * the same notification and mail clients retry sends, so burning the token on
 * first use would silently drop the second reply. Abuse is bounded three other
 * ways instead — `expiresAt`, the `useCount` ceiling, and a per-message
 * idempotency key (idempotency_keys) that stops duplicate *deliveries* of the
 * same message.
 *
 * `expiresAt` is indexed for both the resolve path and the prune script
 * (scripts/maintenance/pruneEmailReplyTokens.ts).
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.schema.createTable('email_reply_tokens', (table) => {
    table.string('id').primary()
    // HMAC-SHA256 hex digest: always 64 characters.
    table.string('tokenHash', 64).notNullable().unique()
    table.string('actorId').notNullable()
    table.string('statusId').notNullable()
    // 'mention' | 'reply' — which notification email minted this token.
    table.string('notificationType').notNullable()
    table.integer('useCount').notNullable().defaultTo(0)
    table.timestamp('lastUsedAt').nullable()
    table.timestamp('expiresAt').notNullable()
    table.timestamp('createdAt').notNullable()

    table.index(['actorId'], 'email_reply_tokens_actor')
    table.index(['expiresAt'], 'email_reply_tokens_expires')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.schema.dropTableIfExists('email_reply_tokens')
}
