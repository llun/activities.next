import { Knex } from 'knex'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  CreateNotificationParams,
  GetNotificationsCountParams,
  GetNotificationsParams,
  MarkNotificationsReadParams,
  Notification,
  NotificationDatabase,
  UpdateNotificationParams
} from '@/lib/database/types/notification'

const fixNotificationDataDate = (data: Notification): Notification => ({
  ...data,
  createdAt: getCompatibleTime(data.createdAt),
  updatedAt: getCompatibleTime(data.updatedAt),
  readAt: data.readAt ? getCompatibleTime(data.readAt) : undefined
})

export const NotificationSQLDatabaseMixin = (
  database: Knex
): NotificationDatabase => ({
  async createNotification({
    actorId,
    type,
    sourceActorId,
    statusId,
    followId,
    groupKey
  }: CreateNotificationParams) {
    const currentTime = new Date()
    const notification: Notification = {
      id: crypto.randomUUID(),
      actorId,
      type,
      sourceActorId,
      statusId,
      followId,
      groupKey,
      isRead: false,
      createdAt: currentTime.getTime(),
      updatedAt: currentTime.getTime()
    }

    await database('notifications').insert({
      ...notification,
      createdAt: currentTime,
      updatedAt: currentTime
    })

    return notification
  },

  async getNotifications({
    actorId,
    limit,
    offset = 0,
    types,
    excludeTypes,
    onlyUnread,
    ids,
    maxNotificationId,
    minNotificationId,
    sinceNotificationId
  }: GetNotificationsParams) {
    let query = database('notifications')
      .where('actorId', actorId)
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc') // Secondary sort for deterministic ordering
      .limit(limit)

    // Support cursor-based pagination
    // Scope cursor lookups to actorId to prevent information leaks
    // Use composite cursor (createdAt, id) to handle same-timestamp notifications
    if (maxNotificationId) {
      const maxNotification = await database('notifications')
        .where('id', maxNotificationId)
        .andWhere('actorId', actorId)
        .first()
      if (maxNotification) {
        // Get notifications older than cursor: (createdAt < cursor) OR (createdAt = cursor AND id < cursor)
        query = query.where(function () {
          this.where('createdAt', '<', maxNotification.createdAt).orWhere(
            function () {
              this.where('createdAt', '=', maxNotification.createdAt).andWhere(
                'id',
                '<',
                maxNotification.id
              )
            }
          )
        })
      }
    }

    if (minNotificationId || sinceNotificationId) {
      const minId = minNotificationId || sinceNotificationId
      const minNotification = await database('notifications')
        .where('id', minId)
        .andWhere('actorId', actorId)
        .first()
      if (minNotification) {
        // Get notifications newer than cursor: (createdAt > cursor) OR (createdAt = cursor AND id > cursor)
        query = query.where(function () {
          this.where('createdAt', '>', minNotification.createdAt).orWhere(
            function () {
              this.where('createdAt', '=', minNotification.createdAt).andWhere(
                'id',
                '>',
                minNotification.id
              )
            }
          )
        })
      }
    }

    // Support offset-based pagination for backward compatibility
    if (!maxNotificationId && !minNotificationId && !sinceNotificationId) {
      query = query.offset(offset)
    }

    if (types && types.length > 0) {
      query = query.whereIn('type', types)
    }

    if (excludeTypes && excludeTypes.length > 0) {
      query = query.whereNotIn('type', excludeTypes)
    }

    if (onlyUnread) {
      query = query.where('isRead', false)
    }

    if (ids && ids.length > 0) {
      query = query.whereIn('id', ids)
    }

    const results = await query
    return results.map(fixNotificationDataDate)
  },

  async getNotificationsCount({
    actorId,
    onlyUnread,
    types
  }: GetNotificationsCountParams) {
    let query = database('notifications').where('actorId', actorId)

    if (onlyUnread) {
      query = query.where('isRead', false)
    }

    if (types && types.length > 0) {
      query = query.whereIn('type', types)
    }

    const result = await query.count<{ count: string }>('* as count').first()
    return parseInt(result?.count ?? '0', 10)
  },

  async markNotificationsRead({
    notificationIds
  }: MarkNotificationsReadParams) {
    if (notificationIds.length === 0) return

    const currentTime = new Date()
    await database('notifications').whereIn('id', notificationIds).update({
      isRead: true,
      readAt: currentTime,
      updatedAt: currentTime
    })
  },

  async updateNotification({
    notificationId,
    isRead,
    readAt
  }: UpdateNotificationParams) {
    const updates: {
      updatedAt: Date
      isRead?: boolean
      readAt?: Date | null
    } = {
      updatedAt: new Date()
    }

    if (isRead !== undefined) {
      updates.isRead = isRead
    }

    if (readAt !== undefined) {
      updates.readAt = new Date(readAt)
    }

    await database('notifications').where('id', notificationId).update(updates)
  },

  async deleteNotification(notificationId: string) {
    await database('notifications').where('id', notificationId).delete()
  }
})
