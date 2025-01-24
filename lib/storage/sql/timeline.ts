import { Knex } from 'knex'

import { Status } from '@/lib/models/status'
import { Timeline } from '@/lib/services/timelines/types'
import { PER_PAGE_LIMIT } from '@/lib/storage'
import { StatusStorage } from '@/lib/storage/types/status'
import {
  CreateTimelineStatusParams,
  GetTimelineParams
} from '@/lib/storage/types/timeline'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/jsonld/activitystream'

export const TimelineSQLStorageMixin = (
  database: Knex,
  statusStorage: StatusStorage
) => ({
  async getTimeline({
    timeline,
    actorId,
    startAfterStatusId
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
          .limit(PER_PAGE_LIMIT)
        const local = await query
        const statuses = (
          await Promise.all(
            local.map((item) =>
              statusStorage.getStatus({ statusId: item.statusId })
            )
          )
        ).filter((item): item is Status => item !== undefined)
        return statuses
      }
      case Timeline.MAIN:
      case Timeline.HOME:
      case Timeline.MENTION:
      case Timeline.NOANNOUNCE: {
        if (!actorId) return []

        const actualTimeline =
          timeline === Timeline.HOME ? Timeline.MAIN : timeline
        const limit = PER_PAGE_LIMIT
        const startAfterId = startAfterStatusId
          ? (
              await database('timelines')
                .where('actorId', actorId)
                .where('timeline', actualTimeline)
                .where('statusId', startAfterStatusId)
                .select('id')
                .first<{ id: number }>()
            ).id
          : 0

        const statusesId = await (startAfterStatusId
          ? database('timelines')
              .where('actorId', actorId)
              .where('timeline', actualTimeline)
              .where('id', '<', startAfterId)
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
              statusStorage.getStatus({ statusId, currentActorId: actorId })
            )
        )

        return statuses.filter(
          (status): status is Status => status !== undefined
        )
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
      if (exists && exists.count) return

      return trx('timelines').insert({
        actorId,
        statusId: status.id,
        statusActorId: status.actorId,
        timeline,
        createdAt: status.createdAt,
        updatedAt: Date.now()
      })
    })
  }
})
