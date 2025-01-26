import { Knex } from 'knex'

import {
  CreateAttachmentParams,
  CreateMediaParams,
  GetAttachmentsForActorParams,
  GetAttachmentsParams,
  MediaDatabase
} from '@/lib/database/types/media'
import { Attachment, AttachmentData } from '@/lib/models/attachment'

export const MediaSQLStorageMixin = (database: Knex): MediaDatabase => ({
  async createMedia({
    actorId,
    original,
    thumbnail,
    description
  }: CreateMediaParams) {
    if (!actorId) return null

    const content = {
      actorId,
      original: original.path,
      originalBytes: original.bytes,
      originalMimeType: original.mimeType,
      originalMetaData: JSON.stringify(original.metaData),
      ...(thumbnail
        ? {
            thumbnail: thumbnail.path,
            thumbnailBytes: thumbnail.bytes,
            thumbnailMimeType: thumbnail.mimeType,
            thumbnailMetaData: JSON.stringify(thumbnail.metaData)
          }
        : null),
      ...(description ? { description } : null)
    }

    const ids = await database('medias').insert(content, ['id'])
    if (ids.length === 0) return null
    return {
      id: ids[0].id,
      actorId,
      original,
      thumbnail,
      description
    }
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
    const data: AttachmentData = {
      id: crypto.randomUUID(),
      actorId,
      statusId,
      type: 'Document',
      mediaType,
      url,
      width,
      height,
      name,
      createdAt: currentTime,
      updatedAt: currentTime
    }
    await database('attachments').insert(data)
    return new Attachment(data)
  },

  async getAttachments({ statusId }: GetAttachmentsParams) {
    const data = await database<AttachmentData>('attachments').where(
      'statusId',
      statusId
    )
    return data.map((item) => new Attachment(item))
  },

  async getAttachmentsForActor({
    actorId
  }: GetAttachmentsForActorParams): Promise<Attachment[]> {
    const data = await database<AttachmentData>('attachments')
      .where('actorId', actorId)
      .orderBy('createdAt')
      .limit(30)
    return data.map((item) => new Attachment(item))
  }
})
