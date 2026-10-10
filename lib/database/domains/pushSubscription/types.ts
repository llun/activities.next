// Parameter and result types of the push subscription domain.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.

// Mastodon WebPushSubscription alert flags. Keys mirror
// https://docs.joinmastodon.org/entities/WebPushSubscription/#alerts
export type PushAlerts = {
  mention: boolean
  status: boolean
  reblog: boolean
  follow: boolean
  follow_request: boolean
  favourite: boolean
  poll: boolean
  update: boolean
  quote: boolean
  quoted_update: boolean
  // Ecosystem dialect (Akkoma parity), not a core Mastodon alert key.
  'pleroma:emoji_reaction': boolean
  'admin.sign_up': boolean
  'admin.report': boolean
}

// Mastodon WebPushSubscription policy — who can generate notifications.
export type PushPolicy = 'all' | 'followed' | 'follower' | 'none'

export interface PushSubscription {
  id: string
  actorId: string
  endpoint: string
  p256dh: string
  auth: string
  alerts: PushAlerts
  policy: PushPolicy
  standard: boolean
  // The plaintext OAuth access token tied to this subscription, when it was
  // created via a bearer token. Included in the Mastodon Web Push payload so
  // native clients can attribute the push and fetch the full notification.
  // Null for browser PushManager subscriptions (web-session auth, no token).
  accessToken?: string
  createdAt: number
  updatedAt: number
}

export type CreatePushSubscriptionParams = {
  actorId: string
  endpoint: string
  p256dh: string
  auth: string
  alerts?: Partial<PushAlerts>
  policy?: PushPolicy
  standard?: boolean
  accessToken?: string
}

export type UpdatePushSubscriptionParams = {
  actorId: string
  endpoint?: string
  alerts?: Partial<PushAlerts>
  policy?: PushPolicy
  // Scope the update to the subscription owned by this access token (per the
  // Mastodon spec, one subscription per token). Without it the update targets
  // the actor's most-recent tokenless (web-session) subscription.
  accessToken?: string
}

export type DeletePushSubscriptionParams = {
  endpoint: string
  actorId: string
}

export type GetPushSubscriptionsForActorParams = {
  actorId: string
}

export type GetPushSubscriptionForActorParams = {
  actorId: string
  // Return the subscription owned by this access token (per the Mastodon
  // spec, one subscription per token). Without it the lookup returns the
  // actor's most-recent tokenless (web-session) subscription.
  accessToken?: string
}

export interface PushSubscriptionDatabase {
  createPushSubscription(
    params: CreatePushSubscriptionParams
  ): Promise<PushSubscription>
  updatePushSubscription(
    params: UpdatePushSubscriptionParams
  ): Promise<PushSubscription | null>
  deletePushSubscription(params: DeletePushSubscriptionParams): Promise<void>
  getPushSubscriptionsForActor(
    params: GetPushSubscriptionsForActorParams
  ): Promise<PushSubscription[]>
  getPushSubscriptionForActor(
    params: GetPushSubscriptionForActorParams
  ): Promise<PushSubscription | null>
}
