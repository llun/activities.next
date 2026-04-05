import webpush from 'web-push'

import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { NotificationType } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'

import { shouldSendPushForNotification } from './pushNotificationSettings'

let vapidInitialized = false
const initVapid = () => {
  if (vapidInitialized) return
  const config = getConfig()
  if (!config.push) return
  const email = config.push.vapidEmail.startsWith('mailto:')
    ? config.push.vapidEmail
    : `mailto:${config.push.vapidEmail}`
  webpush.setVapidDetails(
    email,
    config.push.vapidPublicKey,
    config.push.vapidPrivateKey
  )
  vapidInitialized = true
}

interface PushNotificationPayload {
  title: string
  body: string
  url: string
}

const getNotificationContent = (
  type: NotificationType,
  sourceActor: Actor
): PushNotificationPayload => {
  const displayName = sourceActor.name || sourceActor.username

  switch (type) {
    case 'follow':
      return {
        title: 'New Follower',
        body: `${displayName} followed you`,
        url: '/notifications'
      }
    case 'follow_request':
      return {
        title: 'Follow Request',
        body: `${displayName} wants to follow you`,
        url: '/notifications'
      }
    case 'like':
      return {
        title: 'New Like',
        body: `${displayName} liked your post`,
        url: '/notifications'
      }
    case 'mention':
      return {
        title: 'Mentioned',
        body: `${displayName} mentioned you`,
        url: '/notifications'
      }
    case 'reply':
      return {
        title: 'New Reply',
        body: `${displayName} replied to your post`,
        url: '/notifications'
      }
    case 'reblog':
      return {
        title: 'Reblogged',
        body: `${displayName} reblogged your post`,
        url: '/notifications'
      }
    default:
      return {
        title: 'New Notification',
        body: 'You have a new notification',
        url: '/notifications'
      }
  }
}

export const sendPushNotification = async (params: {
  database: Database
  actorId: string
  type: NotificationType
  sourceActor: Actor
  statusId?: string
  skipSettingsCheck?: boolean
}): Promise<void> => {
  const { database, actorId, type, sourceActor, skipSettingsCheck } = params

  const config = getConfig()
  if (!config.push) return

  if (!skipSettingsCheck) {
    const shouldSend = await shouldSendPushForNotification(
      database,
      actorId,
      type
    )
    if (!shouldSend) return
  }

  const subscriptions = await database.getPushSubscriptionsForActor({ actorId })
  if (subscriptions.length === 0) return

  initVapid()

  const payload = JSON.stringify(getNotificationContent(type, sourceActor))

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth }
          },
          payload
        )
      } catch (error) {
        const webPushError = error as { statusCode?: number }
        // 410 Gone or 404 means subscription expired — clean it up
        if (
          webPushError.statusCode === 410 ||
          webPushError.statusCode === 404
        ) {
          await database.deletePushSubscription({
            endpoint: sub.endpoint,
            actorId
          })
        }
        logger.error({
          message: 'Failed to send push notification',
          endpoint: sub.endpoint,
          err: error
        })
      }
    })
  )
}
