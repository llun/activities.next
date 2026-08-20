// Indexes for the local public timeline — the logged-out landing page and
// `GET /api/v1/timelines/public?local=true`.
//
// Both surfaces select the same set: top-level statuses addressed to the public
// collection, authored by an actor this server hosts. Cloud SQL Query Insights
// had the landing page's threshold count at a 27s average, and its sampled plan
// showed why: a sequential scan of `actors` to find the local ones, then for
// each of those a scan for their statuses, then ~9,000 probes into `recipients`
// that each needed a heap fetch. `lib/database/sql/timeline.ts` fixes the query
// shape (a semi-join so a LIMIT can bound the scan); these three indexes give
// that shape something to run on.
//
// Only `actors_local_idx` is partial, and only because its predicate is a bare
// `IS NOT NULL` that carries no bound parameter — see the note on the statuses
// index for why a parameterised predicate is the wrong tool here. Knex emits
// the `where` clause on PostgreSQL and SQLite; MySQL-compatible clients ignore
// it and get the equivalent full index, which is larger but still correct.

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  await knex.schema.alterTable('actors', function (table) {
    // "Is this actor local?" is `privateKey IS NOT NULL`, and nothing indexed
    // it — so every read of the public timeline sequentially scanned the whole
    // actors table (overwhelmingly remote actors) to find the handful of local
    // ones. Indexing `privateKey` itself is not an option: it holds a PEM key
    // and is a large text column. A partial index over `id` is: it is tiny
    // (one entry per local actor), it answers the join to `statuses.actorId`,
    // and matching the index predicate is itself the local-actor test.
    table.index(['id'], 'actors_local_idx', {
      predicate: knex.whereNotNull('privateKey')
    })
  })

  await knex.schema.alterTable('recipients', function (table) {
    // Lets "does this status have a public 'to' recipient?" be answered from
    // the index alone. The existing `recipiences_statusId_type_idx` is
    // (statusId, type, createdAt, updatedAt) — it locates the candidate rows
    // but omits `actorId`, so evaluating the recipient actually being the
    // public collection cost a random heap fetch per candidate. That was
    // 7.2ms per probe against ~9,000 probes in the sampled plan.
    //
    // The older index is deliberately left in place: its trailing createdAt /
    // updatedAt columns serve other readers, and dropping it belongs to a
    // separate change with its own audit.
    table.index(
      ['statusId', 'type', 'actorId'],
      'recipients_status_type_actor_idx'
    )
  })

  await knex.schema.alterTable('statuses', function (table) {
    // Nothing indexed `statuses.createdAt` at all, so the public feed's
    // `ORDER BY createdAt DESC, id DESC` sorted every candidate status on every
    // page. Led by `reply` — which both public surfaces pin to '' for top-level
    // posts — the remaining columns are in the feed's exact sort order, so a
    // backward scan of the `reply = ''` prefix produces the page directly and
    // the LIMIT stops it after a page's worth of rows.
    //
    // Deliberately a plain index over (reply, createdAt, id) rather than a
    // partial index on (createdAt, id) WHERE reply = ''. The two describe the
    // same rows, but the predicate form is worse twice over: SQLite rejects the
    // bound parameter knex emits for it outright, and on PostgreSQL a partial
    // index is only usable when the planner can prove the query's predicate
    // implies the index's — which it cannot do for `reply = $n` under a generic
    // plan. As an ordinary leading equality column, `reply` has neither
    // problem. The existing `statusesReplyIndex` (reply) and
    // `statuses_reply_type_idx` (reply, type) are left alone.
    table.index(['reply', 'createdAt', 'id'], 'statuses_reply_created_idx')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  await knex.schema.alterTable('statuses', function (table) {
    table.dropIndex(['reply', 'createdAt', 'id'], 'statuses_reply_created_idx')
  })
  await knex.schema.alterTable('recipients', function (table) {
    table.dropIndex(
      ['statusId', 'type', 'actorId'],
      'recipients_status_type_actor_idx'
    )
  })
  await knex.schema.alterTable('actors', function (table) {
    table.dropIndex(['id'], 'actors_local_idx')
  })
}
