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
      case Timeline.MAIN:
      case Timeline.HOME:
      case Timeline.MENTION:
      case Timeline.DIRECT:
      case Timeline.NOANNOUNCE: {
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

        const [maxRow, minRow] = await Promise.all([
          maxStatusId ? lookupTimelineCursor(maxStatusId) : null,
          minStatusId ? lookupTimelineCursor(minStatusId) : null
        ])

        if (maxStatusId && !maxRow) return []
        if (minStatusId && !minRow) return []

        let query = database('timelines')
          .where('actorId', actorId)
          .where('timeline', actualTimeline)

        // Exclusive lists hide their members from the home feed only — the home
        // tab (MAIN/HOME) and its "no announces" variant — never from the
        // mention or direct feeds, where such posts must still surface.
        if (
          timeline === Timeline.MAIN ||
          timeline === Timeline.HOME ||
          timeline === Timeline.NOANNOUNCE
        ) {
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
  }
})
