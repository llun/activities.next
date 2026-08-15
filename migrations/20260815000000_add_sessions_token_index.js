/**
 * Index `sessions.token`, the column every authenticated request looks a
 * session up by.
 *
 * Better-auth resolves a session with `WHERE token = ?` and nothing else. The
 * only index this table had was `sessions_accountId_token_idx` on
 * (`accountId`, `token`), and a B-tree led by `accountId` cannot serve a
 * predicate on `token` alone — so PostgreSQL sequentially scanned `sessions` on
 * every signed-in page view, with the cost growing as sessions accumulate.
 *
 * Deliberately NOT unique. Uniqueness is the correct constraint for a session
 * token and better-auth's own schema declares it, but adding it here would make
 * this migration fail on any deployment that turned out to hold a duplicate,
 * blocking the whole deploy for what is a performance change. An equality
 * lookup is served just as well by a plain index; promoting it to unique is a
 * separate change that wants a data audit first.
 *
 * The composite index is left in place: it still covers lookups that filter by
 * `accountId` (listing or revoking an account's sessions).
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  await knex.schema.alterTable('sessions', function (table) {
    table.index(['token'], 'sessions_token_idx')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  await knex.schema.alterTable('sessions', function (table) {
    table.dropIndex(['token'], 'sessions_token_idx')
  })
}
