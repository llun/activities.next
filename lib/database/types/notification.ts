import { z } from 'zod'

export const NotificationType = z.enum([
  'follow_request',
  'follow',
  'like',
  'mention',
  'reply',
  'reblog'
])

export type NotificationType = z.infer<typeof NotificationType>

export interface Notification {
  id: string
  actorId: string
  type: NotificationType
  sourceActorId: string
  statusId?: string
  followId?: string
  isRead: boolean
  readAt?: number
  groupKey?: string
  createdAt: number
  updatedAt: number
}

export type CreateNotificationParams = {
  actorId: string
  type: NotificationType
  sourceActorId: string
  statusId?: string
  followId?: string
  groupKey?: string
}

export type GetNotificationsParams = {
  actorId: string
  limit: number
  offset?: number
  types?: NotificationType[]
  excludeTypes?: NotificationType[]
  onlyUnread?: boolean
  ids?: string[]
  maxNotificationId?: string
  minNotificationId?: string
  sinceNotificationId?: string
}

export type GetNotificationsCountParams = {
  actorId: string
  onlyUnread?: boolean
  types?: NotificationType[]
}

export type MarkNotificationsReadParams = {
  notificationIds: string[]
}

export type UpdateNotificationParams = {
  notificationId: string
  isRead?: boolean
  readAt?: number
}

export interface NotificationDatabase {
  createNotification(params: CreateNotificationParams): Promise<Notification>
  getNotifications(params: GetNotificationsParams): Promise<Notification[]>
  getNotificationsCount(params: GetNotificationsCountParams): Promise<number>
  markNotificationsRead(params: MarkNotificationsReadParams): Promise<void>
  updateNotification(params: UpdateNotificationParams): Promise<void>
  deleteNotification(notificationId: string): Promise<void>
}
