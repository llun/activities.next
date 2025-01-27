import { Firestore } from '@google-cloud/firestore'

import { urlToId } from '@/lib/database/firestore/urlToId'
import {
  CreateLikeParams,
  DeleteLikeParams,
  GetLikeCountParams,
  LikeDatabase
} from '@/lib/database/types/like'

export const isActorLikedStatus = async (
  fireStore: Firestore,
  statusId: string,
  actorId?: string
) => {
  if (!actorId) return false
  const snapshot = await fireStore
    .doc(`statuses/${urlToId(statusId)}/likes/${urlToId(actorId)}`)
    .get()
  return snapshot.exists
}

export const LikeFirestoreDatabaseMixin = (
  firestore: Firestore
): LikeDatabase => ({
  async createLike({ actorId, statusId }: CreateLikeParams) {
    const snapshot = await firestore.doc(`statuses/${urlToId(statusId)}`).get()
    if (!snapshot.exists) return

    const currentTime = Date.now()
    const isLiked = await isActorLikedStatus(firestore, statusId, actorId)
    if (isLiked) return

    await firestore
      .doc(`statuses/${urlToId(statusId)}/likes/${urlToId(actorId)}`)
      .set({
        actorId,
        statusId,
        createdAt: currentTime,
        updatedAt: currentTime
      })
  },

  async deleteLike({ statusId, actorId }: DeleteLikeParams) {
    await firestore
      .doc(`statuses/${urlToId(statusId)}/likes/${urlToId(actorId)}`)
      .delete()
  },

  async getLikeCount({ statusId }: GetLikeCountParams) {
    const countSnapshot = await firestore
      .collection(`statuses/${urlToId(statusId)}/likes`)
      .count()
      .get()
    return countSnapshot.data().count ?? 0
  }
})
