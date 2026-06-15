/**
 * Adds the local follow preferences Mastodon's POST /accounts/:id/follow
 * accepts: reblogs (show boosts from this account), notify (alert on new
 * posts), and languages (filter the followed account's posts by language).
 * languages is stored as a JSON-encoded text column so it stays portable
 * across SQLite, PostgreSQL, and MySQL-compatible backends.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = (knex) =>
  knex.schema.alterTable('follows', (table) => {
    table.boolean('reblogs').notNullable().defaultTo(true)
    table.boolean('notify').notNullable().defaultTo(false)
    table.text('languages').nullable()
  })

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = (knex) =>
  knex.schema.alterTable('follows', (table) => {
    table.dropColumn('reblogs')
    table.dropColumn('notify')
    table.dropColumn('languages')
  })
