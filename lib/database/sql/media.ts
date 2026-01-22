import { Knex } from 'knex'

import {
  CreateAttachmentParams,
  CreateMediaParams,
  DeleteMediaParams,
  GetAttachmentsForActorParams,
  GetAttachmentsParams,
  GetMediaByIdParams,
  GetMediasForAccountParams,
  GetStorageUsageForAccountParams,
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
    actorId,
    limit = 25,
    maxCreatedAt
  }: GetAttachmentsForActorParams): Promise<Attachment[]> {
    let query = database<Attachment>('attachments')
      .where('actorId', actorId)
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')

    if (maxCreatedAt) {
      query = query.where('createdAt', '<', new Date(maxCreatedAt))
    }

    query = query.limit(limit)

    const data = await query
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

  async getMediasForAccount({
    accountId,
    limit = 100,
    maxCreatedAt
  }: GetMediasForAccountParams): Promise<Media[]> {
    let query = database('medias')
      .join('actors', 'medias.actorId', 'actors.id')
      .where('actors.accountId', accountId)
      .select(
        'medias.id',
        'medias.actorId',
        'medias.original',
        'medias.originalBytes',
        'medias.originalMimeType',
        'medias.originalMetaData',
        'medias.thumbnail',
        'medias.thumbnailBytes',
        'medias.thumbnailMimeType',
        'medias.thumbnailMetaData',
        'medias.description',
        'medias.createdAt'
      )
      .orderBy('medias.createdAt', 'desc')

    if (maxCreatedAt) {
      query = query.where('medias.createdAt', '<', new Date(maxCreatedAt))
    }

    query = query.limit(limit)

    const data = await query
    return data.map((item) => ({
      id: String(item.id),
      actorId: item.actorId,
      original: {
        path: item.original,
        bytes: Number(item.originalBytes),
        mimeType: item.originalMimeType,
        metaData: JSON.parse(item.originalMetaData)
      },
      ...(item.thumbnail
        ? {
            thumbnail: {
              path: item.thumbnail,
              bytes: Number(item.thumbnailBytes),
              mimeType: item.thumbnailMimeType,
              metaData: JSON.parse(item.thumbnailMetaData)
            }
          }
        : {}),
      ...(item.description ? { description: item.description } : {})
    }))
  },

  async getMediaByIdForAccount({
    mediaId,
    accountId
  }: GetMediaByIdParams): Promise<Media | null> {
    const data = await database('medias')
      .join('actors', 'medias.actorId', 'actors.id')
      .where('medias.id', mediaId)
      .where('actors.accountId', accountId)
      .select(
        'medias.id',
        'medias.actorId',
        'medias.original',
        'medias.originalBytes',
        'medias.originalMimeType',
        'medias.originalMetaData',
        'medias.thumbnail',
        'medias.thumbnailBytes',
        'medias.thumbnailMimeType',
        'medias.thumbnailMetaData',
        'medias.description'
      )
      .first()

    if (!data) return null

    return {
      id: String(data.id),
      actorId: data.actorId,
      original: {
        path: data.original,
        bytes: Number(data.originalBytes),
        mimeType: data.originalMimeType,
        metaData: JSON.parse(data.originalMetaData)
      },
      ...(data.thumbnail
        ? {
            thumbnail: {
              path: data.thumbnail,
              bytes: Number(data.thumbnailBytes),
              mimeType: data.thumbnailMimeType,
              metaData: JSON.parse(data.thumbnailMetaData)
            }
          }
        : {}),
      ...(data.description ? { description: data.description } : {})
    }
  },

  async getStorageUsageForAccount({
    accountId
  }: GetStorageUsageForAccountParams): Promise<number> {
    const result = await database('medias')
      .join('actors', 'medias.actorId', 'actors.id')
      .where('actors.accountId', accountId)
      .sum({
        totalOriginal: 'medias.originalBytes',
        totalThumbnail: 'medias.thumbnailBytes'
      })
      .first()

    if (!result) return 0

    const totalOriginal = Number(result.totalOriginal) || 0
    const totalThumbnail = Number(result.totalThumbnail) || 0
    return totalOriginal + totalThumbnail
  },

  async deleteMedia({ mediaId }: DeleteMediaParams): Promise<boolean> {
    const deleted = await database('medias').where('id', mediaId).del()
    return deleted > 0
  }
})
