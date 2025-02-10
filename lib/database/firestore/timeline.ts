import { Firestore } from '@google-cloud/firestore'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { FirestoreStatusDatabase } from '@/lib/database/firestore/status'
import { urlToId } from '@/lib/database/firestore/urlToId'
import {
  CreateTimelineStatusParams,
  GetTimelineParams,
  TimelineDatabase
} from '@/lib/database/types/timeline'
import { Status } from '@/lib/models/status'
import { Timeline } from '@/lib/services/timelines/types'

export const TimelineFirestoreDatabaseMixin = (
  firestore: Firestore,
  statusDatabase: FirestoreStatusDatabase
): TimelineDatabase => ({
  async getTimeline({
    timeline,
    actorId,
    startAfterStatusId
  }: GetTimelineParams) {
    switch (timeline) {
      case Timeline.LOCAL_PUBLIC: {
        const actors = await firestore
          .collection('actors')
          .where('privateKey', '!=', '')
          .get()
        const actorIds = actors.docs.map((doc) => doc.data().id)
        // TODO: Add new index when create status for timeline
        const actorsDocuments = await Promise.all(
          actorIds.map((actorId) =>
            firestore
              .collection('statuses')
              .where('actorId', '==', actorId)
              .where(
                'to',
                'array-contains',
                'https://www.w3.org/ns/activitystreams#Public'
              )
              .where('reply', '==', '')
              .orderBy('createdAt', 'desc')
              .limit(PER_PAGE_LIMIT)
              .get()
          )
        )
        const statuses = await Promise.all(
          actorsDocuments
            .map((item) => item.docs)
            .flat()
            .map((doc) => doc.data())
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((data) => statusDatabase.getStatusFromData(data, false))
        )
        return statuses
          .filter((status): status is Status => Boolean(status))
          .slice(0, PER_PAGE_LIMIT)
      }
      case Timeline.HOME:
      case Timeline.MAIN:
      case Timeline.MENTION:
      case Timeline.NOANNOUNCE: {
        if (!actorId) return []

        const actualTimeline =
          timeline === Timeline.HOME ? Timeline.MAIN : timeline
        let query = firestore
          .collection(`actors/${urlToId(actorId)}/timelines`)
          .where('timeline', '==', actualTimeline)
          .orderBy('createdAt', 'desc')
          .limit(PER_PAGE_LIMIT)
        if (startAfterStatusId) {
          const lastStatus = await firestore
            .collection(`actors/${urlToId(actorId)}/timelines`)
            .where('timeline', '==', actualTimeline)
            .where('statusId', '==', startAfterStatusId)
            .get()
          if (lastStatus.size === 1) {
            query = query.startAfter(lastStatus.docs[0])
          }
        }

        const snapshot = await query.get()
        const statuses = await Promise.all(
          snapshot.docs
            .map((doc) => doc.data().statusId)
            .map(async (statusId) => {
              const statusData = await firestore
                .doc(`statuses/${urlToId(statusId)}`)
                .get()
              return statusDatabase.getStatusFromData(
                statusData.data(),
                false,
                actorId
              )
            })
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
    status,
    timeline,
    actorId
  }: CreateTimelineStatusParams): Promise<void> {
    const currentTime = Date.now()
    const path = `actors/${urlToId(
      actorId
    )}/timelines/${timeline}-${urlToId(status.id)}`
    await firestore.doc(path).set({
      timeline,
      statusId: status.id,
      statusActorId: status.actorId,
      createdAt: status.createdAt,
      updatedAt: currentTime
    })
  }
})
