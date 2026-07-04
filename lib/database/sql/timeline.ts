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
import { Status } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

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
    limit = PER_PAGE_LIMIT
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

        let query = database('recipients')
          .where('recipients.type', 'to')
          .where('recipients.actorId', ACTIVITY_STREAM_PUBLIC)
          .select('statuses.id as statusId')
          .innerJoin('statuses', 'recipients.statusId', 'statuses.id')
          .innerJoin('actors', 'statuses.actorId', 'actors.id')
          .whereNotNull('actors.privateKey')
          .where('statuses.reply', '')
          .limit(limit)

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
        // they differ only in ordering, handled below.
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

        // The home/direct feed is consumed through getFilteredStatusPage, which
        // backfills by paging max_id DESC, so this query stays newest-first for
        // both lower-bound cursors. min_id therefore behaves like since_id here
        // (adjacent-page min_id for the filtered feed is a separate change);
        // the notification and list-timeline layers, consumed directly, do
        // implement true min_id.
        const statusesId = await query
          .select('statusId')
          .orderBy([
            { column: 'createdAt', order: 'desc' },
            { column: 'id', order: 'desc' }
          ])
          .limit(limit)

        const statuses: Array<Status | null> = []
        for (const { statusId } of statusesId) {
          // Keep status hydration sequential; each status load fans out more DB
          // work and parallelizing the outer loop can overflow RSC async tracing.
          statuses.push(
            await statusDatabase.getStatus({
              statusId,
              currentActorId: actorId
            })
          )
        }

        return statuses.filter((status): status is Status => !!status)
      }
      default: {
        return []
      }
    }
  },

  async getLocalPublicStatusesCount(limit?: number): Promise<number> {
    // Mirror the LOCAL_PUBLIC selection in getTimeline: top-level (non-reply)
    // statuses addressed to the public collection and authored by a local actor
    // (one with a private key).
    const query = database('recipients')
      .where('recipients.type', 'to')
      .where('recipients.actorId', ACTIVITY_STREAM_PUBLIC)
      .innerJoin('statuses', 'recipients.statusId', 'statuses.id')
      .innerJoin('actors', 'statuses.actorId', 'actors.id')
      .whereNotNull('actors.privateKey')
      .where('statuses.reply', '')

    // The landing only needs to know whether the count reaches a threshold, not
    // the exact total. When `limit` is given, fetch at most `limit` distinct ids
    // and return how many came back, so the scan stops early instead of counting
    // every public post on every unauthenticated request (a DoS risk at scale).
    if (limit !== undefined) {
      const rows = await query.distinct('statuses.id').limit(limit)
      return rows.length
    }

    const row = await query
      .countDistinct<{ count: string | number }>({ count: 'statuses.id' })
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
