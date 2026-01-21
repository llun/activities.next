import { Database } from '@/lib/database/types'
import { NotificationType } from '@/lib/database/types/notification'

/**
 * Check if email notifications are enabled for a specific notification type
 * @param database Database instance
 * @param actorId Actor ID to check settings for
 * @param notificationType Notification type to check
 * @returns true if email should be sent, false otherwise
 */
export const shouldSendEmailForNotification = async (
  database: Database,
  actorId: string,
  notificationType: NotificationType
): Promise<boolean> => {
  const settings = await database.getActorSettings({ actorId })

  // If no settings or no emailNotifications specified, default to true (send email)
  if (!settings?.emailNotifications) {
    return true
  }

  // Check if the specific notification type is enabled
  // Default to true if not explicitly set to false
  const isEnabled = settings.emailNotifications[notificationType]
  return isEnabled !== false
}
