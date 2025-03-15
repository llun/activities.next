import { Firestore } from '@google-cloud/firestore'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { FirestoreStatusDatabase } from '@/lib/database/firestore/status'
import {
  CreateTimelineStatusParams,
  GetTimelineParams,
  TimelineDatabase
} from '@/lib/database/types/timeline'
import { Status } from '@/lib/models/status'
import { Timeline } from '@/lib/services/timelines/types'
import { urlToId } from '@/lib/utils/urlToId'

export const TimelineFirestoreDatabaseMixin = (
  firestore: Firestore,
  statusDatabase: FirestoreStatusDatabase
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
        const actors = await firestore
          .collection('actors')
          .where('privateKey', '!=', '')
          .get()
        const actorIds = actors.docs.map((doc) => doc.data().id)

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
              .limit(limit)
              .get()
          )
        )

        const statuses = await Promise.all(
          actorsDocuments
            .map((item) => item.docs)
            .flat()
            .map((doc) => doc.data())
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((data) =>
              statusDatabase.getStatusFromData(data, false, undefined, false)
            )
        )
        return statuses
          .filter((status): status is Status => Boolean(status))
          .slice(0, limit)
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
          .limit(limit)

        if (minStatusId || maxStatusId) {
          const [minStatusSnapshot, maxStatusSnapshot] = await Promise.all([
            minStatusId
              ? firestore
                  .collection(`actors/${urlToId(actorId)}/timelines`)
                  .where('timeline', '==', actualTimeline)
                  .where('statusId', '==', minStatusId)
                  .get()
              : Promise.resolve({ size: 0, docs: [] }),
            maxStatusId
              ? firestore
                  .collection(`actors/${urlToId(actorId)}/timelines`)
                  .where('timeline', '==', actualTimeline)
                  .where('statusId', '==', maxStatusId)
                  .get()
              : Promise.resolve({ size: 0, docs: [] })
          ])

          if (minStatusSnapshot.size === 1) {
            query = query.startAfter(minStatusSnapshot.docs[0])
          }

          if (maxStatusSnapshot.size === 1) {
            query = query.endBefore(maxStatusSnapshot.docs[0])
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
                actorId,
                false
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
