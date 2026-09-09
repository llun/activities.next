export interface MarkNotificationsReadParams {
  notificationIds: string[]
}

/**
 * Marks the given notifications as read for the current actor
 */
export const markNotificationsRead = async ({
  notificationIds
}: MarkNotificationsReadParams) => {
  const response = await fetch('/api/v1/notifications/read', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      notification_ids: notificationIds
    })
  })
  return response.ok
}
