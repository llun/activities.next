import { z } from 'zod'

import { matcher } from './utils'

export const PushConfig = z.object({
  vapidPublicKey: z.string(),
  vapidPrivateKey: z.string(),
  vapidEmail: z.string()
})
export type PushConfig = z.infer<typeof PushConfig>

export const getPushConfig = (): { push: PushConfig } | null => {
  if (!matcher('ACTIVITIES_PUSH_')) return null

  const vapidPublicKey = process.env.ACTIVITIES_PUSH_VAPID_PUBLIC_KEY
  const vapidPrivateKey = process.env.ACTIVITIES_PUSH_VAPID_PRIVATE_KEY
  const vapidEmail = process.env.ACTIVITIES_PUSH_VAPID_EMAIL

  if (!vapidPublicKey || !vapidPrivateKey || !vapidEmail) return null

  return { push: { vapidPublicKey, vapidPrivateKey, vapidEmail } }
}
