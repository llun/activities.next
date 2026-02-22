import { Knex } from 'knex'

import {
  CounterKey,
  decreaseCounterValue,
  getCounterValue,
  increaseCounterValue,
  parseCounterValue
} from '@/lib/database/sql/utils/counter'
import {
  AttachmentWithMedia,
  CreateAttachmentParams,
  CreateMediaParams,
  DeleteAttachmentsByIdsParams,
  DeleteMediaParams,
  GetAttachmentsForActorParams,
  GetAttachmentsParams,
  GetAttachmentsWithMediaParams,
  GetMediaByIdParams,
  GetMediasForAccountParams,
  GetStorageUsageForAccountParams,
  Media,
  MediaDatabase,
  PaginatedMediaWithStatus
} from '@/lib/types/database/operations'
import { Attachment } from '@/lib/types/domain/attachment'

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

    return database.transaction(async (trx) => {
      const actor = await trx('actors')
        .where('id', actorId)
        .select<{ accountId: string | null }>('accountId')
        .first()

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

      const ids = await trx('medias').insert(content, ['id'])
      if (ids.length === 0) return null

      const usageDelta = original.bytes + (thumbnail?.bytes ?? 0)
      if (actor?.accountId) {
        if (usageDelta > 0) {
          await increaseCounterValue(
            trx,
            CounterKey.mediaUsage(actor.accountId),
            usageDelta
          )
        }
        await increaseCounterValue(
          trx,
          CounterKey.totalMedia(actor.accountId),
          1
        )
      }

      return {
        id: ids[0].id,
        actorId,
        original,
        ...(thumbnail ? { thumbnail } : null),
        ...(description ? { description } : null)
      } as Media
    })
  },
  async createAttachment({
    actorId,
    statusId,
    mediaType,
    url,
    width,
    height,
    name = '',
    mediaId,
    createdAt
  }: CreateAttachmentParams): Promise<Attachment> {
    const currentTime =
      typeof createdAt === 'number' ? new Date(createdAt) : new Date()
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
      mediaId,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    return data
  },

  async getAttachments({ statusId }: GetAttachmentsParams) {
    const data = await database<Attachment>('attachments')
      .where('statusId', statusId)
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')
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

  async getAttachmentsWithMedia({
    statusId
  }: GetAttachmentsWithMediaParams): Promise<AttachmentWithMedia[]> {
    const data = await database('attachments')
      .where('statusId', statusId)
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')
      .select(
        'id',
        'actorId',
        'statusId',
        'type',
        'mediaType',
        'url',
        'width',
        'height',
        'name',
        'createdAt',
        'updatedAt',
        'mediaId'
      )

    return data
      .map((item) => {
        if (!item.actorId) return null

        const attachment = Attachment.parse({
          ...item,
          width: item.width ?? undefined,
          height: item.height ?? undefined,
          createdAt: getCompatibleTime(item.createdAt),
          updatedAt: getCompatibleTime(item.updatedAt)
        })

        return {
          ...attachment,
          mediaId:
            item.mediaId === null || item.mediaId === undefined
              ? null
              : String(item.mediaId)
        } satisfies AttachmentWithMedia
      })
      .filter((item): item is AttachmentWithMedia => Boolean(item))
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
    // Get total count from counter table for performance
    const totalPromise = getCounterValue(
      database,
      CounterKey.totalMedia(accountId)
    )

    // Then get the paginated items
    let itemsQuery = database('medias')
      .join('actors', 'medias.actorId', 'actors.id')
      .leftJoin('attachments', 'medias.id', 'attachments.mediaId')
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

    const [total, data] = await Promise.all([totalPromise, itemsQuery])

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
    return getCounterValue(database, CounterKey.mediaUsage(accountId))
  },

  async deleteAttachmentsByIds({
    attachmentIds
  }: DeleteAttachmentsByIdsParams): Promise<number> {
    if (attachmentIds.length === 0) {
      return 0
    }

    return database('attachments').whereIn('id', attachmentIds).delete()
  },

  async deleteMedia({ mediaId }: DeleteMediaParams): Promise<boolean> {
    return database.transaction(async (trx) => {
      const media = await trx('medias')
        .where('id', mediaId)
        .select('actorId', 'originalBytes', 'thumbnailBytes')
        .first<{
          actorId: string
          originalBytes: number | string | bigint | null
          thumbnailBytes: number | string | bigint | null
        }>()
      if (!media) return false

      const actor = await trx('actors')
        .where('id', media.actorId)
        .select<{ accountId: string | null }>('accountId')
        .first()

      const deleted = await trx('medias').where('id', mediaId).del()
      if (!deleted) return false

      const usageDelta =
        parseCounterValue(media.originalBytes) +
        parseCounterValue(media.thumbnailBytes)

      if (actor?.accountId) {
        if (usageDelta > 0) {
          await decreaseCounterValue(
            trx,
            CounterKey.mediaUsage(actor.accountId),
            usageDelta
          )
        }
        await decreaseCounterValue(
          trx,
          CounterKey.totalMedia(actor.accountId),
          1
        )
      }

      return true
    })
  }
})
