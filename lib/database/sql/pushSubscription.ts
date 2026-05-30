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

const fixPushSubscription = (row: SQLPushSubscription): PushSubscription => ({
  id: row.id,
  actorId: row.actorId,
  endpoint: row.endpoint,
  p256dh: row.p256dh,
  auth: row.auth,
  alerts: parseStoredAlerts(row.alerts),
  policy: (row.policy as PushPolicy) ?? 'all',
  standard: Boolean(row.standard),
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
    standard
  }: CreatePushSubscriptionParams): Promise<PushSubscription> {
    const id = randomUUID()
    const now = new Date()
    const alertsValue = JSON.stringify(normalizeAlerts(alerts))
    const policyValue = policy ?? 'all'
    const standardValue = standard ?? false

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
        createdAt: now,
        updatedAt: now
      })
      .onConflict('endpoint')
      .merge({
        actorId,
        p256dh,
        auth,
        alerts: alertsValue,
        policy: policyValue,
        standard: standardValue,
        updatedAt: now
      })

    const row = await database<SQLPushSubscription>('push_subscriptions')
      .where({ endpoint })
      .first()

    return fixPushSubscription(row!)
  },

  async updatePushSubscription({
    actorId,
    endpoint,
    alerts,
    policy
  }: UpdatePushSubscriptionParams): Promise<PushSubscription | null> {
    const query = database<SQLPushSubscription>('push_subscriptions').where({
      actorId
    })
    if (endpoint) {
      query.andWhere({ endpoint })
    }
    const existing = await query.orderBy('updatedAt', 'desc').first()
    if (!existing) return null

    const update: Record<string, unknown> = { updatedAt: new Date() }
    if (alerts !== undefined) {
      update.alerts = JSON.stringify(
        normalizeAlerts({ ...parseStoredAlerts(existing.alerts), ...alerts })
      )
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
    actorId
  }: GetPushSubscriptionForActorParams): Promise<PushSubscription | null> {
    const row = await database<SQLPushSubscription>('push_subscriptions')
      .where({ actorId })
      .orderBy('updatedAt', 'desc')
      .first()
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
