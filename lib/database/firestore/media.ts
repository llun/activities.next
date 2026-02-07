import { Firestore } from '@google-cloud/firestore'

import { getCompatibleTime } from '@/lib/database/firestore/utils'
import {
  Attachment,
  CreateAttachmentParams,
  CreateMediaParams,
  DeleteMediaParams,
  GetAttachmentsForActorParams,
  GetAttachmentsParams,
  GetMediaByIdParams,
  GetMediasForAccountParams,
  GetStorageUsageForAccountParams,
  Media,
  MediaDatabase,
  PaginatedMediaWithStatus
} from '@/lib/types/database/operations'

export const MediaFirestoreDatabaseMixin = (
  database: Firestore
): MediaDatabase => ({
  async createMedia(params: CreateMediaParams): Promise<Media | null> {
    const id = crypto.randomUUID()
    const currentTime = new Date()
    const data = {
      ...params,
      id,
      createdAt: currentTime,
      updatedAt: currentTime
    }
    await database.collection('medias').doc(id).set(data)
    const doc = await database.collection('medias').doc(id).get()
    return doc.data() as Media
  },

  async createAttachment(params: CreateAttachmentParams): Promise<Attachment> {
    const id = crypto.randomUUID()
    const currentTime = new Date()
    const data = {
      ...params,
      id,
      createdAt: currentTime,
      updatedAt: currentTime
    }
    await database.collection('attachments').doc(id).set(data)
    return Attachment.parse({
      ...data,
      createdAt: getCompatibleTime(data.createdAt),
      updatedAt: getCompatibleTime(data.updatedAt)
    })
  },

  async getAttachments({ statusId }: GetAttachmentsParams): Promise<Attachment[]> {
    const result = await database
      .collection('attachments')
      .where('statusId', '==', statusId)
      .get()
    return result.docs.map((doc) => {
      const data = doc.data() as any
      return Attachment.parse({
        ...data,
        createdAt: getCompatibleTime(data.createdAt),
        updatedAt: getCompatibleTime(data.updatedAt)
      })
    })
  },

  async getAttachmentsForActor({
    actorId,
    limit = 20,
    maxCreatedAt
  }: GetAttachmentsForActorParams): Promise<Attachment[]> {
    let query = database
      .collection('attachments')
      .where('actorId', '==', actorId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
    
    if (maxCreatedAt) {
      query = query.startAfter(new Date(maxCreatedAt))
    }

    const result = await query.get()
    return result.docs.map((doc) => {
      const data = doc.data() as any
      return Attachment.parse({
        ...data,
        createdAt: getCompatibleTime(data.createdAt),
        updatedAt: getCompatibleTime(data.updatedAt)
      })
    })
  },

  async getMediasWithStatusForAccount({
    accountId,
    limit = 20,
    page = 0,
    maxCreatedAt
  }: GetMediasForAccountParams): Promise<PaginatedMediaWithStatus> {
    // In Firestore this is complex because of accountId vs actorId
    // and paginated results with total count.
    
    // First find actorIds for account
    const actorResult = await database.collection('actors').where('accountId', '==', accountId).get()
    const actorIds = actorResult.docs.map(doc => doc.data().id)
    
    if (actorIds.length === 0) return { items: [], total: 0 }

    let query = database.collection('medias')
      .where('actorId', 'in', actorIds)
      .orderBy('createdAt', 'desc')
    
    const totalCountResult = await query.count().get()
    const total = totalCountResult.data().count

    if (maxCreatedAt) {
      query = query.startAfter(new Date(maxCreatedAt))
    }
    
    query = query.limit(limit).offset(page * limit)

    const result = await query.get()
    const items = await Promise.all(result.docs.map(async doc => {
      const media = doc.data() as any
      // Find statusId from attachments
      const attachmentResult = await database.collection('attachments')
        .where('mediaId', '==', media.id)
        .limit(1)
        .get()
      const statusId = attachmentResult.empty ? undefined : attachmentResult.docs[0].data().statusId
      return {
        ...media,
        statusId,
        createdAt: getCompatibleTime(media.createdAt),
        updatedAt: getCompatibleTime(media.updatedAt)
      }
    }))

    return { items, total }
  },

  async getMediaByIdForAccount({
    mediaId,
    accountId
  }: GetMediaByIdParams): Promise<Media | null> {
    const doc = await database.collection('medias').doc(mediaId).get()
    if (!doc.exists) return null
    const media = doc.data() as any
    
    // Verify ownership
    const actorDoc = await database.collection('actors').doc(encodeURIComponent(media.actorId)).get()
    if (!actorDoc.exists || actorDoc.data()?.accountId !== accountId) return null
    
    return {
      ...media,
      createdAt: getCompatibleTime(media.createdAt),
      updatedAt: getCompatibleTime(media.updatedAt)
    }
  },

  async getStorageUsageForAccount({
    accountId
  }: GetStorageUsageForAccountParams): Promise<number> {
    const actorResult = await database.collection('actors').where('accountId', '==', accountId).get()
    const actorIds = actorResult.docs.map(doc => doc.data().id)
    if (actorIds.length === 0) return 0

    const result = await database.collection('medias')
      .where('actorId', 'in', actorIds)
      .get()
    
    return result.docs.reduce((acc, doc) => {
      const data = doc.data() as any
      return acc + (data.original?.bytes ?? 0) + (data.thumbnail?.bytes ?? 0)
    }, 0)
  },

  async deleteMedia({ mediaId }: DeleteMediaParams): Promise<boolean> {
    const docRef = database.collection('medias').doc(mediaId)
    const doc = await docRef.get()
    if (!doc.exists) return false
    
    await database.runTransaction(async (trx) => {
      trx.delete(docRef)
      const attachments = await database.collection('attachments').where('mediaId', '==', mediaId).get()
      attachments.docs.forEach(d => trx.delete(d.ref))
    })
    return true
  }
})
