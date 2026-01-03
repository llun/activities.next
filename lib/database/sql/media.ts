import { Knex } from 'knex'

import {
  CreateAttachmentParams,
  CreateMediaParams,
  GetAttachmentsForActorParams,
  GetAttachmentsParams,
  Media,
  MediaDatabase
} from '@/lib/database/types/media'
import { Attachment } from '@/lib/models/attachment'

import { getCompatibleTime } from './utils/getCompatibleTime'

export const MediaSQLDatabaseMixin = (database: Knex): MediaDatabase => ({
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
      ...(thumbnail ? { thumbnail } : null),
      ...(description ? { description } : null)
    } as Media
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
    const currentTime = new Date()
    const data = Attachment.parse({
      id: crypto.randomUUID(),
      actorId,
      statusId,
      type: 'Document',
      mediaType,
      url,
      width,
      height,
      name,
      createdAt: currentTime.getTime(),
      updatedAt: currentTime.getTime()
    })
    await database('attachments').insert({
      ...data,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    return data
  },

  async getAttachments({ statusId }: GetAttachmentsParams) {
    const data = await database<Attachment>('attachments').where(
      'statusId',
      statusId
    )
    return data
      .map((item) => {
        if (!item.actorId) return null
        return Attachment.parse({
          ...item,
          width: item.width ?? undefined,
          height: item.height ?? undefined,
          createdAt: getCompatibleTime(item.createdAt),
          updatedAt: getCompatibleTime(item.updatedAt)
        })
      })
      .filter((item): item is Attachment => Boolean(item))
  },

  async getAttachmentsForActor({
    actorId
  }: GetAttachmentsForActorParams): Promise<Attachment[]> {
    const data = await database<Attachment>('attachments')
      .where('actorId', actorId)
      .orderBy('createdAt', 'desc')
      .limit(30)
    return data.map((item) =>
      Attachment.parse({
        ...item,
        width: item.width ?? undefined,
        height: item.height ?? undefined,
        createdAt: getCompatibleTime(item.createdAt),
        updatedAt: getCompatibleTime(item.updatedAt)
      })
    )
  }
})
