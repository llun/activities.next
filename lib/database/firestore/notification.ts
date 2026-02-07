import { Firestore } from '@google-cloud/firestore'

import { getCompatibleTime } from '@/lib/database/firestore/utils'
import {
  CreateNotificationParams,
  GetNotificationsCountParams,
  GetNotificationsParams,
  MarkNotificationsReadParams,
  Notification,
  NotificationDatabase,
  UpdateNotificationParams
} from '@/lib/types/database/operations'

export const NotificationFirestoreDatabaseMixin = (
  database: Firestore
): NotificationDatabase => ({
  async createNotification(
    params: CreateNotificationParams
  ): Promise<Notification> {
    const id = crypto.randomUUID()
    const currentTime = new Date()
    const data = {
      ...params,
      id,
      isRead: false,
      createdAt: currentTime,
      updatedAt: currentTime
    }
    await database.collection('notifications').doc(id).set(data)
    const notification = await this.getNotifications({
      actorId: params.actorId,
      limit: 1,
      ids: [id]
    })
    return notification[0]
  },

  async getNotifications(params: GetNotificationsParams): Promise<Notification[]> {
    let query = database
      .collection('notifications')
      .where('actorId', '==', params.actorId)

    if (params.types && params.types.length > 0) {
      query = query.where('type', 'in', params.types)
    }
    if (params.onlyUnread) {
      query = query.where('isRead', '==', false)
    }
    if (params.ids && params.ids.length > 0) {
      query = query.where('id', 'in', params.ids)
    }

    query = query.orderBy('createdAt', 'desc').limit(params.limit)

    if (params.offset) {
      query = query.offset(params.offset)
    }

    const result = await query.get()
    return result.docs.map((doc) => {
      const data = doc.data() as any
      return {
        ...data,
        createdAt: getCompatibleTime(data.createdAt),
        updatedAt: getCompatibleTime(data.updatedAt),
        readAt: getCompatibleTime(data.readAt)
      }
    })
  },

  async getNotificationsCount(
    params: GetNotificationsCountParams
  ): Promise<number> {
    let query = database
      .collection('notifications')
      .where('actorId', '==', params.actorId)

    if (params.onlyUnread) {
      query = query.where('isRead', '==', false)
    }
    if (params.types && params.types.length > 0) {
      query = query.where('type', 'in', params.types)
    }

    const result = await query.count().get()
    return result.data().count
  },

  async markNotificationsRead({
    notificationIds
  }: MarkNotificationsReadParams): Promise<void> {
    const batch = database.batch()
    const currentTime = new Date()
    notificationIds.forEach((id) => {
      batch.update(database.collection('notifications').doc(id), {
        isRead: true,
        readAt: currentTime,
        updatedAt: currentTime
      })
    })
    await batch.commit()
  },

  async updateNotification(params: UpdateNotificationParams): Promise<void> {
    const { notificationId, ...updateParams } = params
    await database.collection('notifications').doc(notificationId).update({
      ...updateParams,
      updatedAt: new Date()
    })
  },

  async deleteNotification(notificationId: string): Promise<void> {
    await database.collection('notifications').doc(notificationId).delete()
  }
})
