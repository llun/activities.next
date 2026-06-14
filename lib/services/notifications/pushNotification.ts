import webpush from 'web-push'

import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import {
  NotificationType,
  PushAlerts,
  PushSubscription
} from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'

import { internalTypeToMastodon } from './notificationTypeMapping'
import { shouldSendPushForNotification } from './pushNotificationSettings'

// Maps this app's internal NotificationType to the Mastodon WebPushSubscription
// alert key, so a subscription that disabled an alert (e.g. `mention`) is not
// sent that notification. `activity_import` maps to the Mastodon `status`
// alert (see `notificationTypeMapping.ts`, where Mastodon `status` ↔ internal
// `activity_import`).
const NOTIFICATION_TYPE_TO_ALERT: Partial<
  Record<NotificationType, keyof PushAlerts>
> = {
  follow: 'follow',
  follow_request: 'follow_request',
  like: 'favourite',
  mention: 'mention',
  reply: 'mention',
  reblog: 'reblog',
  activity_import: 'status'
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

interface PushNotificationContent {
  title: string
  body: string
}

// The Mastodon Web Push payload. Mirrors `Web::NotificationSerializer` so native
// clients (Mastodon iOS, Ivory, …) decode it into their expected struct and can
// render the notification content, attribute it to the right account via
// `access_token`, and fetch the full notification via `notification_id`. Without
// these fields the client's decoder fails and the notification shows only the
// app icon with no content.
//
// `url` is an additive, non-Mastodon field used by this app's own service
// worker (`public/sw.js`) to deep-link the click; native clients ignore unknown
// keys, so it is safe to include alongside the standard fields.
interface MastodonPushPayload {
  access_token: string
  preferred_locale: string
  notification_id: string
  notification_type: string
  icon?: string
  title: string
  body: string
  url: string
}

const getNotificationContent = (
  type: NotificationType,
  sourceActor: Actor
): PushNotificationContent => {
  const displayName = sourceActor.name || sourceActor.username

  switch (type) {
    case 'follow':
      return {
        title: 'New Follower',
        body: `${displayName} followed you`
      }
    case 'follow_request':
      return {
        title: 'Follow Request',
        body: `${displayName} wants to follow you`
      }
    case 'like':
      return {
        title: 'New Like',
        body: `${displayName} liked your post`
      }
    case 'mention':
      return {
        title: 'Mentioned',
        body: `${displayName} mentioned you`
      }
    case 'reply':
      return {
        title: 'New Reply',
        body: `${displayName} replied to your post`
      }
    case 'reblog':
      return {
        title: 'Reblogged',
        body: `${displayName} reblogged your post`
      }
    default:
      return {
        title: 'New Notification',
        body: 'You have a new notification'
      }
  }
}

// Builds the per-subscription Mastodon Web Push payload. The payload is built
// per subscription because `access_token` differs between subscriptions (each
// native client subscribes with its own token).
const buildPayload = (params: {
  subscription: PushSubscription
  type: NotificationType
  content: PushNotificationContent
  sourceActor: Actor
  notificationId?: string
  preferredLocale: string
}): string => {
  const {
    subscription,
    type,
    content,
    sourceActor,
    notificationId,
    preferredLocale
  } = params

  const payload: MastodonPushPayload = {
    access_token: subscription.accessToken ?? '',
    preferred_locale: preferredLocale,
    // Mastodon's id is an integer; this app uses string ids (matching its
    // notifications API, like GoToSocial's ULIDs), which mainstream clients
    // accept. Fall back to the empty string only for the rare delivery path
    // that has no notification record.
    notification_id: notificationId ?? '',
    notification_type: internalTypeToMastodon(type),
    // `iconUrl` is `string | undefined` today, but coerce a possible null to
    // undefined so JSON.stringify always omits the key (never emits
    // `"icon": null`) and the assignment stays valid if the type ever widens.
    icon: sourceActor.iconUrl ?? undefined,
    title: content.title,
    body: content.body,
    url: '/notifications'
  }

  return JSON.stringify(payload)
}

export const sendPushNotification = async (params: {
  database: Database
  actorId: string
  type: NotificationType
  sourceActor: Actor
  statusId?: string
  notificationId?: string
  preferredLocale?: string
  skipSettingsCheck?: boolean
}): Promise<void> => {
  const {
    database,
    actorId,
    type,
    sourceActor,
    notificationId,
    skipSettingsCheck
  } = params
  // Mastodon serializes the recipient's preferred locale; this app does not
  // track a per-actor UI locale yet, so default to English.
  const preferredLocale = params.preferredLocale ?? 'en'

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

  const content = getNotificationContent(type, sourceActor)

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth }
          },
          buildPayload({
            subscription: sub,
            type,
            content,
            sourceActor,
            notificationId,
            preferredLocale
          }),
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
