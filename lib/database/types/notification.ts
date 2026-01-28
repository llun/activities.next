// Re-export from new location for backward compatibility
export { NotificationType } from '@/lib/types/database/operations'

export type {
  NotificationDatabase,
  Notification,
  CreateNotificationParams,
  GetNotificationsParams,
  GetNotificationsCountParams,
  MarkNotificationsReadParams,
  UpdateNotificationParams
} from '@/lib/types/database/operations'
