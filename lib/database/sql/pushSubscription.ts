import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  CreatePushSubscriptionParams,
  DeletePushSubscriptionParams,
  GetPushSubscriptionForActorParams,
  GetPushSubscriptionsForActorParams,
  PushAlerts,
  PushPolicy,
  PushSubscription,
  PushSubscriptionDatabase,
  UpdatePushSubscriptionParams
} from '@/lib/types/database/operations'

interface SQLPushSubscription {
  id: string
  actorId: string
  endpoint: string
  p256dh: string
  auth: string
  alerts: string | null
  policy: string | null
  standard: boolean | number | null
  accessToken: string | null
  createdAt: number | Date
  updatedAt: number | Date
}

// All alert flags default to false, matching the Mastodon WebPushSubscription
// documentation. Callers opt in to the alerts they want.
export const DEFAULT_PUSH_ALERTS: PushAlerts = {
  mention: false,
  status: false,
  reblog: false,
  follow: false,
  follow_request: false,
  favourite: false,
  poll: false,
  update: false,
  quote: false,
  quoted_update: false,
  'admin.sign_up': false,
  'admin.report': false
}

// Every alert flag enabled. Used by the legacy `/api/v1/push/subscribe` route,
// which has no per-type alert concept and expects to receive every
// notification (gated only by actor-level settings), so its subscriptions must
// not be filtered out by the per-subscription alert check in delivery.
export const ALL_PUSH_ALERTS_ENABLED: PushAlerts = {
  mention: true,
  status: true,
  reblog: true,
  follow: true,
  follow_request: true,
  favourite: true,
  poll: true,
  update: true,
  quote: true,
  quoted_update: true,
  'admin.sign_up': true,
  'admin.report': true
}

const normalizeAlerts = (input?: Partial<PushAlerts> | null): PushAlerts => {
  const result = { ...DEFAULT_PUSH_ALERTS }
  if (!input) return result
  for (const key of Object.keys(DEFAULT_PUSH_ALERTS) as (keyof PushAlerts)[]) {
    if (typeof input[key] === 'boolean') {
      result[key] = input[key] as boolean
    }
  }
  return result
}

export const parseStoredAlerts = (raw: string | null): PushAlerts => {
  // A missing/unreadable `alerts` column means the row predates per-type alerts
  // — a legacy `/subscribe` row, or one inserted by an old app instance during
  // a rolling deploy before it learned about the column. Treat it as
  // all-enabled (the legacy "send everything" behavior) so those subscriptions
  // are not silently dropped by the alert filter. New-route rows always store
  // an explicit JSON object, so their opted-out alerts are still honored.
  if (!raw) return { ...ALL_PUSH_ALERTS_ENABLED }
  try {
    return normalizeAlerts(getCompatibleJSON<Partial<PushAlerts>>(raw))
  } catch {
    return { ...ALL_PUSH_ALERTS_ENABLED }
  }
}

// Resolves "the caller's subscription" per the Mastodon spec: when an access
// token is supplied, only that token's row (or, failing that, a legacy row
// created before tokens were stored — accessToken NULL) can match; another
// token's subscription is never returned, so clients can't clobber each
// other. Tokenless (web-session) lookups keep the most-recent-for-actor
// behavior.
const findOwnedSubscription = async (
  database: Knex,
  {
    actorId,
    endpoint,
    accessToken
  }: { actorId: string; endpoint?: string; accessToken?: string }
): Promise<SQLPushSubscription | undefined> => {
  const baseQuery = () => {
    const query = database<SQLPushSubscription>('push_subscriptions').where({
      actorId
    })
    if (endpoint) {
      query.andWhere({ endpoint })
    }
    return query.orderBy('updatedAt', 'desc')
  }

  if (!accessToken) {
    return baseQuery().first()
  }

  const owned = await baseQuery().andWhere({ accessToken }).first()
  if (owned) return owned
  return baseQuery().whereNull('accessToken').first()
}

const fixPushSubscription = (row: SQLPushSubscription): PushSubscription => ({
  id: row.id,
  actorId: row.actorId,
  endpoint: row.endpoint,
  p256dh: row.p256dh,
  auth: row.auth,
  alerts: parseStoredAlerts(row.alerts),
  policy: (row.policy as PushPolicy) ?? 'all',
  standard: Boolean(row.standard),
  accessToken: row.accessToken ?? undefined,
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt)
})

export const PushSubscriptionSQLDatabaseMixin = (
  database: Knex
): PushSubscriptionDatabase => ({
  async createPushSubscription({
    actorId,
    endpoint,
    p256dh,
    auth,
    alerts,
    policy,
    standard,
    accessToken
  }: CreatePushSubscriptionParams): Promise<PushSubscription> {
    const id = randomUUID()
    const now = new Date()
    const alertsValue = JSON.stringify(normalizeAlerts(alerts))
    const policyValue = policy ?? 'all'
    const standardValue = standard ?? false

    const mergeValues: Record<string, unknown> = {
      actorId,
      p256dh,
      auth,
      alerts: alertsValue,
      policy: policyValue,
      standard: standardValue,
      updatedAt: now
    }
    // Only overwrite the stored access token when a new one is supplied. A
    // tokenless re-subscribe of the same endpoint (e.g. a web-session request)
    // must not wipe a token a native client previously registered, or its
    // subsequent payloads would lose `access_token`.
    if (accessToken) {
      mergeValues.accessToken = accessToken
    }

    await database('push_subscriptions')
      .insert({
        id,
        actorId,
        endpoint,
        p256dh,
        auth,
        alerts: alertsValue,
        policy: policyValue,
        standard: standardValue,
        accessToken: accessToken ?? null,
        createdAt: now,
        updatedAt: now
      })
      .onConflict('endpoint')
      .merge(mergeValues)

    // The Mastodon spec allows one subscription per access token, and a
    // client re-subscribing after its push endpoint rotated (e.g. an iOS
    // device token refresh) sends a new endpoint. Drop the token's rows for
    // other endpoints so stale subscriptions don't accumulate.
    if (accessToken) {
      await database('push_subscriptions')
        .where({ actorId, accessToken })
        .whereNot({ endpoint })
        .delete()
    }

    const row = await database<SQLPushSubscription>('push_subscriptions')
      .where({ endpoint })
      .first()

    return fixPushSubscription(row!)
  },

  async updatePushSubscription({
    actorId,
    endpoint,
    alerts,
    policy,
    accessToken
  }: UpdatePushSubscriptionParams): Promise<PushSubscription | null> {
    const existing = await findOwnedSubscription(database, {
      actorId,
      endpoint,
      accessToken
    })
    if (!existing) return null

    const update: Record<string, unknown> = { updatedAt: new Date() }
    // Claim legacy pre-token rows on write so they converge to token
    // ownership and stop matching other tokens' NULL fallback.
    if (accessToken) {
      update.accessToken = accessToken
    }
    if (alerts !== undefined) {
      // Mastodon's "change types" PUT replaces the alert set: alert flags not
      // included in the request are treated as false, not merged with the
      // previous value. Callers pass `undefined` (not an empty object) when the
      // request carries no alerts at all, so a policy-only update leaves the
      // stored alerts untouched.
      update.alerts = JSON.stringify(normalizeAlerts(alerts))
    }
    if (policy !== undefined) {
      update.policy = policy
    }

    await database('push_subscriptions')
      .where({ id: existing.id })
      .update(update)

    const row = await database<SQLPushSubscription>('push_subscriptions')
      .where({ id: existing.id })
      .first()
    return row ? fixPushSubscription(row) : null
  },

  async deletePushSubscription({
    endpoint,
    actorId
  }: DeletePushSubscriptionParams): Promise<void> {
    await database('push_subscriptions').where({ endpoint, actorId }).delete()
  },

  async getPushSubscriptionsForActor({
    actorId
  }: GetPushSubscriptionsForActorParams): Promise<PushSubscription[]> {
    const rows = await database<SQLPushSubscription>(
      'push_subscriptions'
    ).where({ actorId })
    return rows.map(fixPushSubscription)
  },

  async getPushSubscriptionForActor({
    actorId,
    accessToken
  }: GetPushSubscriptionForActorParams): Promise<PushSubscription | null> {
    const row = await findOwnedSubscription(database, { actorId, accessToken })
    return row ? fixPushSubscription(row) : null
  },

  async deletePushSubscriptionsForActor({
    actorId
  }: {
    actorId: string
  }): Promise<void> {
    await database('push_subscriptions').where({ actorId }).delete()
  }
})
