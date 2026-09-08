export interface PushSubscriptionKeys {
  p256dh: string
  auth: string
}

export type NotificationSettings = Record<string, boolean>

export const getVapidKey = async (): Promise<string | null> => {
  const response = await fetch('/api/v1/push/vapid-key')
  if (!response.ok) return null
  const data = await response.json()
  return data.vapidPublicKey as string
}

export const updateEmailNotifications = async (
  actorId: string,
  settings: Record<string, boolean>
): Promise<boolean> => {
  const response = await fetch('/api/v1/accounts/email-notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorId, ...settings })
  })
  return response.ok
}

export const subscribePushNotifications = async (
  endpoint: string,
  keys: PushSubscriptionKeys
): Promise<boolean> => {
  const response = await fetch('/api/v1/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint, keys })
  })
  return response.ok
}

export const unsubscribePushNotifications = async (
  endpoint: string
): Promise<boolean> => {
  const response = await fetch('/api/v1/push/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint })
  })
  return response.ok
}

export const updatePushNotifications = async (
  actorId: string,
  settings: Record<string, boolean>
): Promise<boolean> => {
  const response = await fetch('/api/v1/accounts/push-notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorId, ...settings })
  })
  return response.ok
}
