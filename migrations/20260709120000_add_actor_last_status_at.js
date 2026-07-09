/**
 * Persist `actors.lastStatusAt` so the Mastodon directory `order=active` sort and
 * the serializer's `last_status_at` no longer run a live `MAX(statuses.createdAt)
 * GROUP BY actorId` aggregation on every read. The column tracks the greatest
 * `createdAt` across ALL of the actor's `statuses` rows (including `Announce`
 * reblogs) so the serialized `last_status_at` stays identical to the previous
 * aggregation. It is maintained inside the status create/delete transactions
 * (see `lib/database/sql/status.ts`) and read by `lib/database/sql/actor.ts`.
 *
 * The `(domain, lastStatusAt)` index serves the directory `active` query, which
 * filters by `domain` and orders by `lastStatusAt`.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.schema.alterTable('actors', (table) => {
    // Match `actors.createdAt` (timestamp with time zone on PostgreSQL) so
    // comparisons and ordering behave identically across backends.
    table.timestamp('lastStatusAt', { useTz: true }).nullable()
    table.index(['domain', 'lastStatusAt'], 'actors_domain_last_status_at_idx')
  })

  // Backfill existing rows from the statuses table with a correlated subquery.
  // Built through the query builder so it runs on both SQLite and PostgreSQL;
  // actors with no statuses stay NULL (MAX over no rows is NULL).
  await knex('actors').update({
    lastStatusAt: knex('statuses')
      .max('createdAt')
      .where('statuses.actorId', knex.ref('actors.id'))
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.schema.alterTable('actors', (table) => {
    table.dropIndex(
      ['domain', 'lastStatusAt'],
      'actors_domain_last_status_at_idx'
    )
    table.dropColumn('lastStatusAt')
  })
}
