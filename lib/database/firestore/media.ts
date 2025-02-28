import { Firestore } from '@google-cloud/firestore'

import {
  CreateAttachmentParams,
  CreateMediaParams,
  GetAttachmentsForActorParams,
  GetAttachmentsParams,
  Media,
  MediaDatabase
} from '@/lib/database/types/media'
import { Attachment } from '@/lib/models/attachment'
import { urlToId } from '@/lib/utils/urlToId'

export const MediaFirestoreDatabaseMixin = (
  firestore: Firestore
): MediaDatabase => ({
  async createMedia({
    actorId,
    original,
    thumbnail,
    description
  }: CreateMediaParams): Promise<Media | null> {
    if (!actorId) return null

    const id = crypto.randomUUID()
    const currentTime = Date.now()
    const media = {
      id,
      actorId,
      original,
      ...(thumbnail ? { thumbnail } : null),
      ...(description ? { description } : null),
      createdAt: currentTime,
      updatedAt: currentTime
    }
    await firestore.doc(`medias/${id}`).set(media)
    return media
  },

  async createAttachment({
    actorId,
    statusId,
    mediaType,
    url,
    width,
    height,
    name = ''
  }: CreateAttachmentParams): Promise<Attachment> {
    const currentTime = Date.now()
    const id = crypto.randomUUID()
    const data = Attachment.parse({
      id,
      actorId,
      statusId,
      type: 'Document',
      mediaType,
      url,
      ...(width ? { width } : null),
      ...(height ? { height } : null),
      name,

      createdAt: currentTime,
      updatedAt: currentTime
    })
    await firestore
      .doc(`statuses/${urlToId(statusId)}/attachments/${id}`)
      .set(data)
    return data
  },

  async getAttachments({ statusId }: GetAttachmentsParams) {
    const snapshot = await firestore
      .collection(`statuses/${urlToId(statusId)}/attachments`)
      .get()
    return snapshot.docs.map((item) => Attachment.parse(item.data()))
  },

  async getAttachmentsForActor({
    actorId
  }: GetAttachmentsForActorParams): Promise<Attachment[]> {
    const attachments = await firestore
      .collectionGroup('attachments')
      .where('actorId', '==', actorId)
      .orderBy('createdAt', 'desc')
      .limit(30)
      .get()
    return attachments.docs.map((item) => Attachment.parse(item.data()))
  }
})
