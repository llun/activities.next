import { Firestore } from '@google-cloud/firestore'

import {
  CreateTimelineStatusParams,
  GetTimelineParams,
  TimelineDatabase
} from '@/lib/types/database/operations'
import { Status } from '@/lib/types/domain/status'

export const TimelineFirestoreDatabaseMixin = (
  database: Firestore,
  statusDatabase: any
): TimelineDatabase => ({
  async getTimeline({
    timeline,
    actorId,
    minStatusId,
    maxStatusId,
    limit = 20
  }: GetTimelineParams): Promise<Status[]> {
    let query = database
      .collection('timelines')
      .where('timeline', '==', timeline)
    
    if (actorId) {
      query = query.where('actorId', '==', actorId)
    }

    query = query.orderBy('statusId', 'desc').limit(limit)

    if (maxStatusId) {
      query = query.startAfter(maxStatusId)
    }
    if (minStatusId) {
      query = query.endBefore(minStatusId)
    }

    const result = await query.get()
    const statusIds = result.docs.map((doc) => doc.data().statusId)
    return statusDatabase.getStatusesByIds({ statusIds })
  },

  async createTimelineStatus({
    timeline,
    actorId,
    status
  }: CreateTimelineStatusParams): Promise<void> {
    const id = `${timeline}:${actorId}:${status.id}`
    await database.collection('timelines').doc(encodeURIComponent(id)).set({
      timeline,
      actorId,
      statusId: status.id,
      createdAt: new Date(status.createdAt),
      updatedAt: new Date()
    })
  }
})
