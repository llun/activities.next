import { sql } from 'kysely'

import type { Db } from '@/lib/database/kysely'
import { getWhereInBatchSize } from '@/lib/database/kysely/inList'
import { isLocalActor } from '@/lib/database/kysely/visibility/localActor'
import { publiclyReadableStatus } from '@/lib/database/kysely/visibility/publiclyReadable'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

// Bind parameters localPublicStatusesQuery is assumed to spend on things that
// are not actor ids. The Knex query reserved 12 for `reply`, the recipient
// type and actor, three per cursor bound, and `limit`; the publicly-readable
// predicate added after that binds nine more (the two public recipients three
// times, the Announce type three times), so with every option on the query
// binds 19 besides the ids, on both backends and in both the Knex and the
// Kysely form. The 12 is kept so the same number of local actors selects the
// same form: SQLITE_MAX_BINDINGS (999) sits far below the 32,766 variables the
// bundled SQLite accepts, so the 7 it undercounts never reach a real limit.
const LOCAL_PUBLIC_RESERVED_BINDINGS = 12

// The most actor ids this query carries as literal values; see the note on
// localPublicStatusesQuery for what happens above it.
const getLocalActorIdLimit = (db: Db) =>
  getWhereInBatchSize(db, LOCAL_PUBLIC_RESERVED_BINDINGS)

// The ids of every actor this server hosts, capped one past what the query can
// use. Read once per public-timeline request and passed into the query below
// as literal values; see the note there for why this is a separate query
// rather than a join.
//
// The cap is what keeps this bounded on an anonymous path. Unbounded, an
// instance too large for the literal-id form would read every local actor id
// over the wire — 20,005 of them measured at 418 buffers and ~630 KB — and
// then discard the whole list, because the branch it selects only needs the
// length. Reading one more than the limit still tells "fits" from "does not",
// which is all either caller asks.
export const getLocalActorIds = async (db: Db): Promise<string[]> => {
  const rows = await db
    .selectFrom('actors')
    .select('id')
    .where(isLocalActor)
    .limit(getLocalActorIdLimit(db) + 1)
    .execute()
  // The column is a primary key on PostgreSQL; the SQLite schema leaves it
  // nullable, and a NULL id matches no status either way.
  return rows.map((row) => row.id as string)
}

// Top-level (non-reply) statuses addressed to the public collection and
// authored by a local actor (one with a private key). The LOCAL_PUBLIC feed
// and the landing page's threshold count select exactly this set, so they
// share one builder rather than restating the predicates.
//
// `recipients` is a SEMI-join here, not a join: a status qualifies when it has
// at least one matching recipient row, and must be produced once however many
// it has. Expressing that with EXISTS instead of an inner join is what lets a
// LIMIT actually bound the scan. The inner join form multiplied rows and
// needed DISTINCT to collapse them again, and a sort feeding DISTINCT has to
// consume the *entire* join before LIMIT sees a single row — so
// `SELECT DISTINCT … LIMIT n` never stopped early, and the planner, with no
// limit to push down, optimised for total cost and drove from the least
// selective side (every local actor, then all of their statuses). That is what
// put this query at ~27s on the logged-out landing page.
//
// It also removes a latent duplicate: the feed had no DISTINCT at all, so a
// status carrying the public collection twice in `to` (remote input is not
// de-duplicated on insert) appeared twice in the timeline.
//
// The local-actor test is an IN over ids fetched separately, NOT a join to
// `actors`, because the join form is fragile in a way that shows up
// differently on production and on a local reproduction — and is bad on both.
//
// ON PRODUCTION (Query Insights, plus a read-only EXPLAIN session against the
// pre-fix query): 88ms average, and a plan that changed with `limit` alone,
// crossing over at 24. A page of 23 ran an index scan over
// `statuses_reply_created_idx` in ~1ms / 228 buffers; the API's own default of
// 30 switched to a parallel sequential scan of `actors`, gathered every status
// those actors had written and sorted the lot — ~88ms and 35,108 buffers to
// return 30 rows. The planner estimated 150 eligible rows against 7,262 actual.
//
// The cause is a cardinality miss the join itself creates. Joining on
// `actors.id`, a unique key, leaves the planner no statistic correlating an
// actor with how much it posts, so it assumes statuses are spread evenly
// across actors. Literal ids give it `statuses.actorId`'s own histogram and
// MCV list instead, which describe exactly that skew.
//
// A local seed matching production's ROW COUNTS does not reproduce its
// STATISTICS, so it does not reproduce that crossover — there the null-only
// join stays fast at every limit (~160/~164/~200 buffers at 23/24/30). What it
// does show is worse and is the reason both halves of this change ship
// together: see the measurement below.
//
// The extra round trip stays on `actors_local_idx` rather than scanning
// `actors` — 11 buffers on the seed. It is NOT an index-only scan: that index
// carries `id` alone and its partial predicate covers only the `IS NOT NULL`
// half, so `privateKey <> ''` is a heap-fetched recheck. Widening the index
// predicate to both halves would restore `Heap Fetches: 0` and is deliberately
// not done: after the migration the index holds one entry per genuinely local
// actor, so there is almost nothing left to recheck.
//
// Early termination here rests on local posts being reasonably dense near the
// head of the global (reply='', createdAt DESC) ordering, since the scan walks
// that index and discards non-local rows. In the measured shape the 30th
// eligible row sits at position 80. Pushing every local status five years back
// made the same query walk 44,291 non-matching entries for 12,140 buffers — no
// better than the fallback, and the planner does not switch. Bounded by table
// size and fine at this scale, but on an instance where remote inflow far
// outpaces local posting the first page's cost tracks remote volume.
//
// One bind parameter per local actor is not free forever, and on SQLite it is
// a hard wall rather than a slope: past SQLITE_MAX_VARIABLE_NUMBER the
// statement fails to prepare. Chunking — the usual answer, and what
// `selectInChunks` does — cannot apply to a query whose whole purpose is a
// single LIMIT-bounded ordered scan. So above the same threshold the rest of
// the codebase uses, this falls back to a semi-join on `actors`.
//
// That fallback is a CORRECTNESS valve, not an equivalent plan, and it is
// worth being precise about how much it gives up. Measured on a local
// PostgreSQL 17 loaded to the same shape as production (5 local actors, 216
// legacy empty-key ones, 2,971 eligible rows, 79k statuses), buffers at limit
// 23 / 24 / 30:
//
//     literal ids                      137 /  142 /  176
//     either join form, with `<> ''`   ~16,700, flat across all three
//     inner join, `IS NOT NULL` only   ~160 /  ~164 /  ~200
//
// The two join forms share ONE row because PostgreSQL gives them one plan: it
// rewrites the unique-key inner join into the same `Nested Loop Semi Join`,
// down to matching cost estimates and per-node buffers. So the EXISTS fallback
// is not a cheaper shape than the join it replaced — do not "optimise" toward
// it on the strength of a number that only ever differed by which session
// measured it.
//
// Only the first row is exact. The rest are a band on purpose: the `<> ''`
// plans traverse all 2,971 eligible rows and take 441 heap fetches, and heap
// fetches move with visibility-map state, so repeated measurement on identical
// data has read 16,202 / 16,306 / 16,658 / 16,866. The literal-id form
// early-terminates with `Heap Fetches: 0` and has nothing to drift. That
// difference — full materialization versus early termination — is the whole
// finding; the digits are not.
//
// Read the middle row against the last. Once the correctness predicate is
// present, the join loses early termination outright at EVERY page size,
// because the planner drives from `actors` and cannot then use
// `statuses_reply_created_idx` to satisfy the ORDER BY, so it materializes
// every eligible row and top-N sorts them. (Widening the partial
// `actors_local_idx` predicate to match does not recover that: the index gets
// used and the sort remains.) Only the literal-id form keeps `statuses` as the
// driving relation.
//
// So the two halves of this change cannot ship apart. Adding `<> ''` to the
// join — the correctness fix on its own — is what turns a ~200-buffer query
// into a ~16,700-buffer one here, an ~80x jump; and on production the pre-fix
// query was already past the crossover at its own default page size. The
// literal ids are what make the predicate affordable.
//
// So an instance that trips this threshold gets a correct answer and a slow
// one. The fix at that point is per-chunk LIMIT-bounded queries merged in
// application code, not a different predicate — deliberately not built here,
// because no instance is near the threshold and an untested path for a
// hypothetical scale is its own liability.
export const localPublicStatusesQuery = (db: Db, localActorIds: string[]) => {
  const query = db
    .selectFrom('statuses')
    .where('statuses.reply', '=', '')
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('recipients')
          .select(sql.lit(1).as('one'))
          .whereRef('recipients.statusId', '=', 'statuses.id')
          .where('recipients.type', '=', 'to')
          .where('recipients.actorId', '=', ACTIVITY_STREAM_PUBLIC)
      )
    )
    // The `to: Public` test above decides "listed", but only for this row's
    // own audience: a public Announce of a followers-only or direct note
    // passes it, and the landing page and /api/v1/timelines/public then unwrap
    // the boost and render the original to anonymous readers. The readability
    // predicate follows the announce chain; a non-Announce row short-circuits
    // on its first disjunct, and the correlated form stays LIMIT-bounded on
    // both the feed and the landing count's `limit` path.
    .where((eb) => publiclyReadableStatus(db, eb))

  if (localActorIds.length <= getLocalActorIdLimit(db)) {
    return query.where('statuses.actorId', 'in', localActorIds)
  }

  return query.where((eb) =>
    eb.exists(
      eb
        .selectFrom('actors')
        .select(sql.lit(1).as('one'))
        .whereRef('actors.id', '=', 'statuses.actorId')
        .where(isLocalActor)
    )
  )
}
