import { Database } from '@/lib/database/types'
import { NotificationType } from '@/lib/types/database/operations'

/**
 * Check if push notifications are enabled for a specific notification type
 * @param database Database instance
 * @param actorId Actor ID to check settings for
 * @param notificationType Notification type to check
 * @returns true if push should be sent, false otherwise
 */
export const shouldSendPushForNotification = async (
  database: Database,
  actorId: string,
  notificationType: NotificationType
): Promise<boolean> => {
  const settings = await database.getActorSettings({ actorId })

  // If no settings or no pushNotifications specified, default to true (send push)
  if (!settings?.pushNotifications) {
    return true
  }

  // Check if the specific notification type is enabled
  // Default to true if not explicitly set to false
  const isEnabled = settings.pushNotifications[notificationType]
  return isEnabled !== false
}
