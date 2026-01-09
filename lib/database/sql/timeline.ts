import { Knex } from 'knex'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { StatusDatabase } from '@/lib/database/types/status'
import {
  CreateTimelineStatusParams,
  GetTimelineParams,
  TimelineDatabase
} from '@/lib/database/types/timeline'
import { Status } from '@/lib/models/status'
import { Timeline } from '@/lib/services/timelines/types'
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
        const query = database('recipients')
          .leftJoin('statuses', 'recipients.statusId', 'statuses.id')
          .leftJoin('actors', 'statuses.actorId', 'actors.id')
          .where('recipients.type', 'to')
          .where('recipients.actorId', ACTIVITY_STREAM_PUBLIC)
          .whereNotNull('actors.privateKey')
          .where('statuses.reply', '')
          .orderBy('recipients.createdAt', 'desc')
          .limit(limit)
        const local = await query
        const statuses = (
          await Promise.all(
            local.map((item) =>
              statusDatabase.getStatus({ statusId: item.statusId })
            )
          )
        ).filter((item): item is Status => !!item)
        return statuses
      }
      case Timeline.MAIN:
      case Timeline.HOME:
      case Timeline.MENTION:
      case Timeline.NOANNOUNCE: {
        if (!actorId) return []

        const actualTimeline =
          timeline === Timeline.HOME ? Timeline.MAIN : timeline
        const minId = minStatusId
          ? ((
              await database('timelines')
                .where('actorId', actorId)
                .where('timeline', actualTimeline)
                .where('statusId', minStatusId)
                .select('id')
                .first<{ id: number }>()
            )?.id ?? 0)
          : 0
        const maxId = maxStatusId
          ? ((
              await database('timelines')
                .where('actorId', actorId)
                .where('timeline', actualTimeline)
                .where('statusId', maxStatusId)
                .select('id')
                .first<{ id: number }>()
            )?.id ?? 0)
          : 0

        if (maxId - minId < 0) {
          return []
        }

        const statusesId = await (minId || maxId
          ? database('timelines')
              .where('actorId', actorId)
              .where('timeline', actualTimeline)
              .where('id', '<', maxId)
              .where('id', '>', minId)
              .select('statusId')
              .orderBy('createdAt', 'desc')
              .limit(limit)
          : database('timelines')
              .where('actorId', actorId)
              .where('timeline', actualTimeline)
              .select('statusId')
              .orderBy('createdAt', 'desc')
              .limit(limit))

        const statuses = await Promise.all(
          statusesId
            .map((item) => item.statusId)
            .map((statusId) =>
              statusDatabase.getStatus({ statusId, currentActorId: actorId })
            )
        )

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
