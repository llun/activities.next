// Reorders the announce lookup index on `statuses` from
// (type, "actorId", "originalStatusId") to (type, "originalStatusId", "actorId").
//
// `20260517000000_add_status_original_status_id.js` created the index as
// (type, "actorId", "originalStatusId"). Every query that reads it constrains
// `type` and `originalStatusId`; only some of them also constrain `actorId`:
//
//   - hasActorAnnouncedStatus / getActorAnnounceStatus /
//     getActorAnnouncedStatusId / the batched announce hydration in
//     getStatusesHydrationContext — all three columns, so the order is
//     immaterial to them.
//   - getRebloggedBy (`GET /api/v1/statuses/:id/reblogged_by`) — `type` and
//     `originalStatusId` only. With `actorId` in the middle it cannot be an
//     index condition at all, so that query bitmap-scanned EVERY Announce row
//     and filtered them down to the handful that boosted the status.
//
// Measured on a local PostgreSQL 18 seeded to production's shape (176,465
// statuses, 19,920 Announce rows over 19,743 distinct originals), warm cache:
// getRebloggedBy goes from 13,862 buffers / 11-20 ms to 7 buffers / 0.04 ms,
// while the three-column callers stay at 3 buffers on an index-only scan. The
// index itself shrinks from 6,456 kB to 4,968 kB. Production's own plan for
// that endpoint on 2026-08-22 was 8,973 buffers / 18.4 ms, scanning 19,892 rows
// to return 1.
//
// A second, smaller effect: with `actorId` demoted to third place behind a
// near-unique column, this index stops being a candidate for `actorId`-only
// lookups. PostgreSQL 18's B-tree skip scan had been choosing it for those over
// `statuses_actorId_idx` — skipping the three `type` values — because
// `cost_index` prices heap I/O from the LEADING column's correlation, and
// `type` scores 0.79 purely for being low-cardinality where `actorId` scores
// -0.18. That mis-costing was close to free (the heap fetches dominate and are
// the same either way: 1,911 buffers versus 1,902 on the seed), so it is a
// side effect of this change rather than a reason for it. Skipping over
// `originalStatusId` instead is hopeless, so the planner stops trying.
//
// Ordered create-then-drop rather than drop-then-create. Some paths run
// migrations with no transaction — `disableTransactions: true` in
// `lib/database/sql/index.ts`, and `--disable-transactions` on the Dockerfile's
// build-time `knex migrate:latest` — so a failure between the two statements
// must not leave the table with no announce index at all. This way it leaves a
// redundant one instead, which costs space until the migration is re-run and
// nothing else.
//
// `CREATE INDEX` takes a lock that blocks writes to `statuses` for the duration
// (about a second at production's row count), matching every other index
// migration in this directory.

const OLD_INDEX = 'statuses_announce_actor_original_idx'
const NEW_INDEX = 'statuses_announce_original_actor_idx'

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  await knex.schema.alterTable('statuses', function (table) {
    table.index(['type', 'originalStatusId', 'actorId'], NEW_INDEX)
  })
  await knex.schema.alterTable('statuses', function (table) {
    table.dropIndex(['type', 'actorId', 'originalStatusId'], OLD_INDEX)
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  await knex.schema.alterTable('statuses', function (table) {
    table.index(['type', 'actorId', 'originalStatusId'], OLD_INDEX)
  })
  await knex.schema.alterTable('statuses', function (table) {
    table.dropIndex(['type', 'originalStatusId', 'actorId'], NEW_INDEX)
  })
}
