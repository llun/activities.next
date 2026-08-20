import { Knex } from 'knex'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { applyExclusiveListFilter } from '@/lib/database/sql/utils/exclusiveLists'
import { Timeline } from '@/lib/services/timelines/types'
import { StatusDatabase } from '@/lib/types/database/operations'
import {
  CreateTimelineStatusParams,
  GetTimelineParams,
  TimelineDatabase
} from '@/lib/types/database/operations'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

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
const localPublicStatusesQuery = (database: Knex) =>
  database('statuses')
    .innerJoin('actors', 'statuses.actorId', 'actors.id')
    .whereNotNull('actors.privateKey')
    .where('statuses.reply', '')
    .whereExists(function () {
      this.select(database.raw('1'))
        .from('recipients')
        .whereRaw('?? = ??', ['recipients.statusId', 'statuses.id'])
        .where('recipients.type', 'to')
        .where('recipients.actorId', ACTIVITY_STREAM_PUBLIC)
    })

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

        const [maxRow, minRow] = await Promise.all([
          maxStatusId ? lookupPublicCursor(maxStatusId) : null,
          minStatusId ? lookupPublicCursor(minStatusId) : null
        ])

        if (maxStatusId && !maxRow) return []
        if (minStatusId && !minRow) return []

        let query = localPublicStatusesQuery(database)
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
    const query = localPublicStatusesQuery(database)

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

    // No DISTINCT needed: the semi-join yields each status once, and the actors
    // join is on a unique key.
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
