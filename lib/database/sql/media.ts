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
  MediaDatabase,
  PaginatedMediaWithStatus
} from '@/lib/database/types/media'
import { Attachment } from '@/lib/models/attachment'

import { getCompatibleJSON } from './utils/getCompatibleJSON'
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
      ...(original.fileName ? { originalFileName: original.fileName } : null),
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

  async getMediasWithStatusForAccount({
    accountId,
    limit = 100,
    page = 1,
    maxCreatedAt
  }: GetMediasForAccountParams): Promise<PaginatedMediaWithStatus> {
    // First, get the total count
    const countQuery = database('medias')
      .join('actors', 'medias.actorId', 'actors.id')
      .where('actors.accountId', accountId)
      .count('medias.id as count')
      .first()

    // Then get the paginated items
    let itemsQuery = database('medias')
      .join('actors', 'medias.actorId', 'actors.id')
      .leftJoin('attachments', function () {
        // Match media with attachments using LIKE pattern matching (database-agnostic)
        // Handles:
        // 1. Direct match: attachments.url = medias.original (for test fixtures)
        // 2. URL ends with path: attachments.url LIKE '%' || medias.original (for S3/ObjectStorage)
        //
        // Note: For local storage where URLs contain only filenames, this won't match
        // because the full filesystem path isn't present in the URL. This is a limitation
        // of using database-agnostic queries without substring extraction.
        this.on('medias.original', '=', 'attachments.url')
        this.orOn(database.raw("attachments.url LIKE '%' || medias.original"))
        this.orOn('medias.thumbnail', '=', 'attachments.url')
        this.orOn(database.raw("attachments.url LIKE '%' || medias.thumbnail"))
      })
      .where('actors.accountId', accountId)
      .distinct(
        'medias.id',
        'medias.actorId',
        'medias.original',
        'medias.originalBytes',
        'medias.originalMimeType',
        'medias.originalMetaData',
        'medias.originalFileName',
        'medias.thumbnail',
        'medias.thumbnailBytes',
        'medias.thumbnailMimeType',
        'medias.thumbnailMetaData',
        'medias.description',
        'medias.createdAt',
        'attachments.statusId'
      )
      .orderBy('medias.createdAt', 'desc')

    if (maxCreatedAt) {
      itemsQuery = itemsQuery.where(
        'medias.createdAt',
        '<',
        new Date(maxCreatedAt)
      )
    }

    // Calculate offset for pagination
    const offset = (page - 1) * limit
    itemsQuery = itemsQuery.limit(limit).offset(offset)

    const [countResult, data] = await Promise.all([countQuery, itemsQuery])
    const total = Number(countResult?.count || 0)

    const items = data.map((item) => ({
      id: String(item.id),
      actorId: item.actorId,
      original: {
        path: item.original,
        bytes: Number(item.originalBytes),
        mimeType: item.originalMimeType,
        metaData: getCompatibleJSON(item.originalMetaData),
        ...(item.originalFileName ? { fileName: item.originalFileName } : {})
      },
      ...(item.thumbnail
        ? {
            thumbnail: {
              path: item.thumbnail,
              bytes: Number(item.thumbnailBytes),
              mimeType: item.thumbnailMimeType,
              metaData: getCompatibleJSON(item.thumbnailMetaData)
            }
          }
        : {}),
      ...(item.description ? { description: item.description } : {}),
      ...(item.statusId ? { statusId: item.statusId } : {})
    }))

    return { items, total }
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
        'medias.originalFileName',
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
        metaData: getCompatibleJSON(data.originalMetaData),
        ...(data.originalFileName ? { fileName: data.originalFileName } : {})
      },
      ...(data.thumbnail
        ? {
            thumbnail: {
              path: data.thumbnail,
              bytes: Number(data.thumbnailBytes),
              mimeType: data.thumbnailMimeType,
              metaData: getCompatibleJSON(data.thumbnailMetaData)
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
