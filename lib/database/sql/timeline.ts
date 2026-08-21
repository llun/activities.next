import { Knex } from 'knex'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { applyExclusiveListFilter } from '@/lib/database/sql/utils/exclusiveLists'
import { getWhereInBatchSize } from '@/lib/database/sql/utils/knex'
import { whereLocalActor } from '@/lib/database/sql/utils/localActor'
import { Timeline } from '@/lib/services/timelines/types'
import { StatusDatabase } from '@/lib/types/database/operations'
import {
  CreateTimelineStatusParams,
  GetTimelineParams,
  TimelineDatabase
} from '@/lib/types/database/operations'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

// Bind parameters this query spends on things that are not actor ids: `reply`,
// the recipient type and actor, three per cursor bound, and `limit`. Measured
// at 10 by compiling the builder with every option on; 12 leaves margin.
const LOCAL_PUBLIC_RESERVED_BINDINGS = 12

// The most actor ids this query can carry as literal values — see the note on
// localPublicStatusesQuery for what happens above it.
const getLocalActorIdLimit = (database: Knex) =>
  getWhereInBatchSize(database, LOCAL_PUBLIC_RESERVED_BINDINGS)

// The ids of every actor this server hosts, capped one past what the query can
// use. Read once per public-timeline request and pushed into the query below as
// literal values — see the note there for why this is a separate query rather
// than a join.
//
// The cap is what keeps this bounded on an anonymous path. Unbounded, an
// instance too large for the literal-id form would pluck every local actor id
// over the wire — 20,005 of them measured at 418 buffers and ~630 KB — and then
// discard the whole list, because the branch it selects only needs the length.
// Reading one more than the limit still distinguishes "fits" from "does not",
// which is all either caller asks.
const getLocalActorIds = (database: Knex): Promise<string[]> =>
  database('actors')
    .modify(whereLocalActor)
    .limit(getLocalActorIdLimit(database) + 1)
    .pluck('id')

// Top-level (non-reply) statuses addressed to the public collection and
// authored by a local actor (one with a private key). The LOCAL_PUBLIC feed and
// the landing page's threshold count select exactly this set, so they share one
// builder rather than restating the predicates.
//
// `recipients` is a SEMI-join here, not a join: a status qualifies when it has
// at least one matching recipient row, and must be produced once however many
// it has. Expressing that with `whereExists` instead of `innerJoin` is what
// lets a LIMIT actually bound the scan. The `innerJoin` form multiplied rows
// and needed DISTINCT to collapse them again, and a sort feeding DISTINCT has
// to consume the *entire* join before LIMIT sees a single row — so
// `SELECT DISTINCT … LIMIT n` never stopped early, and the planner, with no
// limit to push down, optimised for total cost and drove from the least
// selective side (every local actor, then all of their statuses). That is what
// put this query at ~27s on the logged-out landing page.
//
// It also removes a latent duplicate: the feed had no DISTINCT at all, so a
// status carrying the public collection twice in `to` (remote input is not
// de-duplicated on insert) appeared twice in the timeline.
//
// The local-actor test is a `whereIn` over ids fetched separately, NOT a join
// to `actors`, because the join form is fragile in a way that shows up
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
// actor with how much it posts, so it assumes statuses are spread evenly across
// actors. Literal ids give it `statuses.actorId`'s own histogram and MCV list
// instead, which describe exactly that skew.
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
// One bind parameter per local actor is not free forever, and on SQLite it is a
// hard wall rather than a slope: past SQLITE_MAX_VARIABLE_NUMBER the statement
// fails to prepare. Chunking — the usual answer, and what
// `deleteRowsByColumnChunks` does — cannot apply to a query whose whole purpose
// is a single LIMIT-bounded ordered scan. So above the same threshold the rest
// of the codebase uses, this falls back to a semi-join on `actors`.
//
// That fallback is a CORRECTNESS valve, not an equivalent plan, and it is worth
// being precise about how much it gives up. Measured on a local PostgreSQL 17
// loaded to the same shape as production (5 local actors, 216 legacy empty-key
// ones, 2,971 eligible rows, 79k statuses), buffers at limit 23 / 24 / 30:
//
//     literal ids                      137 /  142 /  176
//     either join form, with `<> ''`   ~16,700, flat across all three
//     inner join, `IS NOT NULL` only   ~160 /  ~164 /  ~200
//
// The two join forms share ONE row because PostgreSQL gives them one plan: it
// rewrites the unique-key inner join into the same `Nested Loop Semi Join`,
// down to matching cost estimates and per-node buffers. So the `whereExists`
// fallback is not a cheaper shape than the join it replaced — do not "optimise"
// toward it on the strength of a number that only ever differed by which
// session measured it.
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
// into a ~16,700-buffer one here, an ~80x jump; and on production the pre-fix query was
// already past the crossover at its own default page size. The literal ids are
// what make the predicate affordable.
//
// So an instance that trips this threshold gets a correct answer and a slow
// one. The fix at that point is per-chunk LIMIT-bounded queries merged in
// application code, not a different predicate — deliberately not built here,
// because no instance is near the threshold and an untested path for a
// hypothetical scale is its own liability.
const localPublicStatusesQuery = (database: Knex, localActorIds: string[]) => {
  const query = database('statuses')
    .where('statuses.reply', '')
    .whereExists(function () {
      this.select(database.raw('1'))
        .from('recipients')
        .whereRaw('?? = ??', ['recipients.statusId', 'statuses.id'])
        .where('recipients.type', 'to')
        .where('recipients.actorId', ACTIVITY_STREAM_PUBLIC)
    })

  if (localActorIds.length <= getLocalActorIdLimit(database)) {
    return query.whereIn('statuses.actorId', localActorIds)
  }

  return query.whereExists(function () {
    this.select(database.raw('1'))
      .from('actors')
      .whereRaw('?? = ??', ['actors.id', 'statuses.actorId'])
      .modify(whereLocalActor, 'actors.privateKey')
  })
}

export const TimelineSQLDatabaseMixin = (
  database: Knex,
  statusDatabase: StatusDatabase
): TimelineDatabase => ({
  async getTimeline({
    timeline,
    actorId,
    minStatusId,
    sinceStatusId,
    maxStatusId,
    limit = PER_PAGE_LIMIT,
    onlyMedia = false
  }: GetTimelineParams) {
    switch (timeline) {
      case Timeline.LOCAL_PUBLIC: {
        const lookupPublicCursor = async (
          statusId: string
        ): Promise<{ id: string; createdAt: Date } | null> => {
          const statusRow = await database('statuses')
            .where('id', statusId)
            .select('id', 'createdAt')
            .first<{ id: string; createdAt: Date }>()
          return statusRow ?? null
        }

        const [maxRow, minRow, localActorIds] = await Promise.all([
          maxStatusId ? lookupPublicCursor(maxStatusId) : null,
          minStatusId ? lookupPublicCursor(minStatusId) : null,
          getLocalActorIds(database)
        ])

        if (maxStatusId && !maxRow) return []
        if (minStatusId && !minRow) return []
        // A server with no local actors has no local public timeline. Returning
        // early keeps that case from reaching the database at all, rather than
        // relying on knex compiling an empty `whereIn` to a false constant.
        if (localActorIds.length === 0) return []

        let query = localPublicStatusesQuery(database, localActorIds)
          .select('statuses.id as statusId')
          .limit(limit)

        if (onlyMedia) {
          query = query.whereExists(function () {
            this.select(database.raw('1'))
              .from('attachments')
              .whereRaw('?? = ??', ['attachments.statusId', 'statuses.id'])
          })
        }

        if (maxRow) {
          query = query.where((wb) => {
            wb.where('statuses.createdAt', '<', maxRow.createdAt).orWhere(
              (wb2) => {
                wb2
                  .where('statuses.createdAt', '=', maxRow.createdAt)
                  .where('statuses.id', '<', maxRow.id)
              }
            )
          })
        }

        if (minRow) {
          query = query.where((wb) => {
            wb.where('statuses.createdAt', '>', minRow.createdAt).orWhere(
              (wb2) => {
                wb2
                  .where('statuses.createdAt', '=', minRow.createdAt)
                  .where('statuses.id', '>', minRow.id)
              }
            )
          })
        }

        const local = await query
          .orderBy('statuses.createdAt', 'desc')
          .orderBy('statuses.id', 'desc')
        const statuses = await statusDatabase.getStatusesByIds({
          statusIds: local.map((item) => item.statusId)
        })
        return statuses
      }
      case Timeline.FEDERATED_PUBLIC: {
        // Remote public statuses ingested from accepted relays. Materialized in
        // `federated_timeline`; we join back to `statuses` and page with the
        // same (createdAt, id) keyset the LOCAL_PUBLIC branch uses.
        const lookupCursor = async (
          statusId: string
        ): Promise<{ id: string; createdAt: Date } | null> => {
          const statusRow = await database('statuses')
            .where('id', statusId)
            .select('id', 'createdAt')
            .first<{ id: string; createdAt: Date }>()
          return statusRow ?? null
        }

        const [maxRow, minRow] = await Promise.all([
          maxStatusId ? lookupCursor(maxStatusId) : null,
          minStatusId ? lookupCursor(minStatusId) : null
        ])

        if (maxStatusId && !maxRow) return []
        if (minStatusId && !minRow) return []

        let query = database('federated_timeline')
          .select('statuses.id as statusId')
          .innerJoin('statuses', 'federated_timeline.statusId', 'statuses.id')
          // Top-level posts only, matching LOCAL_PUBLIC and Mastodon's public
          // timeline semantics (replies are excluded).
          .where('statuses.reply', '')
          .limit(limit)

        if (onlyMedia) {
          query = query.whereExists(function () {
            this.select(database.raw('1'))
              .from('attachments')
              .whereRaw('?? = ??', ['attachments.statusId', 'statuses.id'])
          })
        }

        if (maxRow) {
          query = query.where((wb) => {
            wb.where('statuses.createdAt', '<', maxRow.createdAt).orWhere(
              (wb2) => {
                wb2
                  .where('statuses.createdAt', '=', maxRow.createdAt)
                  .where('statuses.id', '<', maxRow.id)
              }
            )
          })
        }

        if (minRow) {
          query = query.where((wb) => {
            wb.where('statuses.createdAt', '>', minRow.createdAt).orWhere(
              (wb2) => {
                wb2
                  .where('statuses.createdAt', '=', minRow.createdAt)
                  .where('statuses.id', '>', minRow.id)
              }
            )
          })
        }

        const rows = await query
          .orderBy('statuses.createdAt', 'desc')
          .orderBy('statuses.id', 'desc')
        const statuses = await statusDatabase.getStatusesByIds({
          statusIds: rows.map((item) => item.statusId)
        })
        return statuses
      }
      case Timeline.MAIN:
      case Timeline.HOME:
      case Timeline.DIRECT: {
        if (!actorId) return []

        const actualTimeline =
          timeline === Timeline.HOME ? Timeline.MAIN : timeline

        const lookupTimelineCursor = async (
          statusId: string
        ): Promise<{ id: number | null; createdAt: Date } | null> => {
          const timelineRow = await database('timelines')
            .where('actorId', actorId)
            .where('timeline', actualTimeline)
            .where('statusId', statusId)
            .select('id', 'createdAt')
            .first<{ id: number; createdAt: Date }>()
          if (timelineRow) return timelineRow

          // Fallback: status may have been deleted from the timeline (e.g. after
          // deletion) but we still have the status creation time available. Use it
          // as the cursor without the row-id tie-breaker so pagination can continue.
          const statusRow = await database('statuses')
            .where('id', statusId)
            .select('createdAt')
            .first<{ createdAt: Date }>()
          return statusRow ? { id: null, createdAt: statusRow.createdAt } : null
        }

        // min_id and since_id are both lower-bound cursors (rows newer than it);
        // they differ only in ordering, handled below. min_id ascends from the
        // cursor (the oldest rows just newer than it) then reverses to
        // newest-first, returning the page adjacent to the cursor; since_id /
        // max_id / no cursor keep DESC (the newest slice above the cursor).
        const ascending = Boolean(minStatusId)
        const lowerBoundStatusId = minStatusId || sinceStatusId
        const [maxRow, minRow] = await Promise.all([
          maxStatusId ? lookupTimelineCursor(maxStatusId) : null,
          lowerBoundStatusId ? lookupTimelineCursor(lowerBoundStatusId) : null
        ])

        if (maxStatusId && !maxRow) return []
        if (lowerBoundStatusId && !minRow) return []

        let query = database('timelines')
          .where('actorId', actorId)
          .where('timeline', actualTimeline)

        // Exclusive lists hide their members from the home feed only — the home
        // tab (MAIN/HOME) — never from the direct feed, where such posts must
        // still surface.
        if (timeline === Timeline.MAIN || timeline === Timeline.HOME) {
          applyExclusiveListFilter({ database, query, viewerActorId: actorId })
        }

        if (maxRow) {
          query = query.where((wb) => {
            wb.where('createdAt', '<', maxRow.createdAt).orWhere((wb2) => {
              if (maxRow.id !== null) {
                wb2
                  .where('createdAt', '=', maxRow.createdAt)
                  .where('id', '<', maxRow.id)
              }
            })
          })
        }

        if (minRow) {
          query = query.where((wb) => {
            wb.where('createdAt', '>', minRow.createdAt).orWhere((wb2) => {
              if (minRow.id !== null) {
                wb2
                  .where('createdAt', '=', minRow.createdAt)
                  .where('id', '>', minRow.id)
              }
            })
          })
        }

        // min_id scans ascending (oldest rows just newer than the cursor) so the
        // keyset seek + limit lands on the page adjacent to the cursor; the id
        // list is reversed below to the newest-first response shape. Every other
        // cursor kind (since_id / max_id / none) stays newest-first DESC. The
        // filtered home/direct feed (getFilteredStatusPage) mirrors this: it
        // backfills DESC for since/max and ascends for min_id.
        const order: 'asc' | 'desc' = ascending ? 'asc' : 'desc'
        const statusesId = await query
          .select('statusId')
          .orderBy([
            { column: 'createdAt', order },
            { column: 'id', order }
          ])
          .limit(limit)
        // Ascending (min_id) rows come back oldest-first; flip to newest-first.
        if (ascending) statusesId.reverse()

        // One batched hydration rather than a status-at-a-time loop: this is the
        // busiest page in the app, and the per-status path re-queries detected
        // languages, quote edges, bookmarks, likes and reaction rollups once per
        // row. getStatusesByIds returns them in the ids' order, so the timeline
        // ordering established above is preserved. (The loop this replaces was
        // sequential to avoid a parallel fan-out overflowing RSC async tracing;
        // a single batched call does not fan out at all.)
        return statusDatabase.getStatusesByIds({
          statusIds: statusesId.map(({ statusId }) => statusId),
          currentActorId: actorId
        })
      }
      default: {
        return []
      }
    }
  },

  async getLocalPublicStatusesCount(limit?: number): Promise<number> {
    // Shares localPublicStatusesQuery with the LOCAL_PUBLIC branch of
    // getTimeline, so the threshold can never disagree with the feed it gates.
    const localActorIds = await getLocalActorIds(database)
    if (localActorIds.length === 0) return 0

    const query = localPublicStatusesQuery(database, localActorIds)

    // The landing only needs to know whether the count reaches a threshold, not
    // the exact total. When `limit` is given, fetch at most `limit` ids and
    // return how many came back, so the scan stops early instead of counting
    // every public post on every unauthenticated request (a DoS risk at scale).
    // The semi-join is what makes that bound real — see the note on
    // localPublicStatusesQuery for why the DISTINCT form it replaced could not
    // stop early despite carrying the same LIMIT.
    if (limit !== undefined) {
      const rows = await query.select('statuses.id').limit(limit)
      return rows.length
    }

    // No DISTINCT needed: the recipients semi-join yields each status once, and
    // the local-actor test is a filter on `statuses` rather than a join that
    // could multiply rows.
    const row = await query
      .count<{ count: string | number }>({ count: 'statuses.id' })
      .first()
    // count() returns a string on PostgreSQL and a number on SQLite.
    return row ? Number(row.count) : 0
  },

  async createTimelineStatus({
    actorId,
    status,
    timeline
  }: CreateTimelineStatusParams): Promise<void> {
    await database.transaction(async (trx) => {
      const exists = await trx('timelines')
        .where('actorId', actorId)
        .andWhere('statusId', status.id)
        .andWhere('timeline', timeline)
        .count<{ count: string }>('* as count')
        .first()
      if (exists && parseInt(exists.count, 10)) return

      return trx('timelines').insert({
        actorId,
        statusId: status.id,
        statusActorId: status.actorId,
        timeline,
        createdAt: new Date(status.createdAt),
        updatedAt: new Date()
      })
    })
  },

  async addStatusToFederatedTimeline({ statusId, statusActorId }) {
    // Idempotent append — a relay can forward the same public status more than
    // once (e.g. via multiple relays), so ignore a duplicate primary key.
    await database('federated_timeline')
      .insert({
        statusId,
        statusActorId,
        createdAt: new Date()
      })
      .onConflict('statusId')
      .ignore()
  }
})
