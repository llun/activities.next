import { Firestore } from '@google-cloud/firestore'

import {
  CreateLikeParams,
  DeleteLikeParams,
  GetLikeCountParams,
  IsActorLikedStatusParams,
  LikeDatabase
} from '@/lib/types/database/operations'

export const LikeFirestoreDatabaseMixin = (
  database: Firestore
): LikeDatabase => ({
  async createLike({ actorId, statusId }: CreateLikeParams): Promise<void> {
    const id = `${actorId}:${statusId}`
    await database.collection('likes').doc(encodeURIComponent(id)).set({
      actorId,
      statusId,
      createdAt: new Date()
    })
  },

  async deleteLike({ actorId, statusId }: DeleteLikeParams): Promise<void> {
    const id = `${actorId}:${statusId}`
    await database.collection('likes').doc(encodeURIComponent(id)).delete()
  },

  async getLikeCount({ statusId }: GetLikeCountParams): Promise<number> {
    const result = await database
      .collection('likes')
      .where('statusId', '==', statusId)
      .count()
      .get()
    return result.data().count
  },

  async isActorLikedStatus({
    actorId,
    statusId
  }: IsActorLikedStatusParams): Promise<boolean> {
    const id = `${actorId}:${statusId}`
    const doc = await database
      .collection('likes')
      .doc(encodeURIComponent(id))
      .get()
    return doc.exists
  }
})
