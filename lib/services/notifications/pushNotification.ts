import webpush from 'web-push'

import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { NotificationType, PushAlerts } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'

import { shouldSendPushForNotification } from './pushNotificationSettings'

// Maps this app's internal NotificationType to the Mastodon WebPushSubscription
// alert key, so a subscription that disabled an alert (e.g. `mention`) is not
// sent that notification. Types without a Mastodon alert (e.g. the internal
// `activity_import`) are not gated by per-subscription alerts.
const NOTIFICATION_TYPE_TO_ALERT: Partial<
  Record<NotificationType, keyof PushAlerts>
> = {
  follow: 'follow',
  follow_request: 'follow_request',
  like: 'favourite',
  mention: 'mention',
  reply: 'mention',
  reblog: 'reblog'
}

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

  const allSubscriptions = await database.getPushSubscriptionsForActor({
    actorId
  })
  const alertKey = NOTIFICATION_TYPE_TO_ALERT[type]
  const subscriptions = allSubscriptions.filter((sub) => {
    // Honor the Mastodon WebPushSubscription policy: `none` opts a subscription
    // out of all push notifications. (`followed`/`follower` require
    // relationship checks against the source actor and are not yet enforced.)
    if (sub.policy === 'none') return false
    // Honor the per-subscription alert toggle for this notification type, when
    // a row carries alert preferences and the type maps to a Mastodon alert.
    if (alertKey && sub.alerts && sub.alerts[alertKey] === false) return false
    return true
  })
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
          payload,
          {
            // Match the encryption to the encoding advertised in the
            // WebPushSubscription `standard` flag: `true` → RFC8291 standard
            // `aes128gcm` (the web-push default), `false` → legacy `aesgcm`.
            contentEncoding: sub.standard ? 'aes128gcm' : 'aesgcm'
          }
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
