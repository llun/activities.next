import { randomUUID } from 'node:crypto'

import type {
  CreatePushSubscriptionParams,
  DeletePushSubscriptionParams,
  GetPushSubscriptionForActorParams,
  GetPushSubscriptionsForActorParams,
  PushAlerts,
  PushPolicy,
  PushSubscription,
  UpdatePushSubscriptionParams
} from '@/lib/database/domains/pushSubscription/types'
import type { Db } from '@/lib/database/kysely'

// How many push subscriptions one actor may hold. One per device or app is
// the normal shape; see `createPushSubscription` for how the cap is applied.
export const MAX_PUSH_SUBSCRIPTIONS_PER_ACTOR = 20

const COLUMNS = [
  'id',
  'actorId',
  'endpoint',
  'p256dh',
  'auth',
  'alerts',
  'policy',
  'standard',
  'accessToken',
  'createdAt',
  'updatedAt'
] as const

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
  // Deliberately true, unlike every Mastodon-documented flag above.
  // `pleroma:emoji_reaction` is an ecosystem extension that no Mastodon client
  // will ever request, and `normalizeAlerts` resolves a key absent from a
  // stored row to this default — so `false` would permanently suppress reaction
  // pushes for every subscription that predates the key, i.e. all of them. An
  // Akkoma-aware client that explicitly sets it false is still honoured.
  'pleroma:emoji_reaction': true,
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
  'pleroma:emoji_reaction': true,
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
    return normalizeAlerts(JSON.parse(raw) as Partial<PushAlerts> | null)
  } catch {
    return { ...ALL_PUSH_ALERTS_ENABLED }
  }
}

type Row = {
  id: string
  actorId: string
  endpoint: string
  p256dh: string
  auth: string
  alerts: string | null
  policy: string
  standard: boolean
  accessToken: string | null
  // Nullable in the schema, but every writer sets them.
  createdAt: number | null
  updatedAt: number | null
}

const fixPushSubscription = (row: Row): PushSubscription => ({
  id: row.id,
  actorId: row.actorId,
  endpoint: row.endpoint,
  p256dh: row.p256dh,
  auth: row.auth,
  alerts: parseStoredAlerts(row.alerts),
  policy: row.policy as PushPolicy,
  standard: row.standard,
  accessToken: row.accessToken ?? undefined,
  createdAt: row.createdAt ?? 0,
  updatedAt: row.updatedAt ?? 0
})

// Resolves "the caller's subscription" per the Mastodon spec (one subscription
// per access token). Token-scoped and tokenless requests live in disjoint
// partitions so neither can touch the other's rows — which is what stops
// multiple clients (web, iOS, …) from reading, updating, or deleting each
// other's subscriptions:
//   - With a token, only that token's own row matches — never another token's
//     row and never a legacy tokenless row.
//   - Without a token (web-session), only tokenless rows match (accessToken
//     NULL) — never a native client's token-owned row. If a web-session
//     lookup fell through to the most-recent row across all tokens, it could
//     retrieve/delete a native client's subscription and re-introduce the
//     clobbering this fixes.
// Legacy tokenless rows (created before the accessToken column) are not
// adopted by a token here; POST migrates them instead, since its
// endpoint-keyed upsert reassigns ownership when a client re-registers the
// same endpoint with its token.
const findOwnedSubscription = (
  db: Db,
  {
    actorId,
    endpoint,
    accessToken
  }: { actorId: string; endpoint?: string; accessToken?: string }
) => {
  let query = db
    .selectFrom('push_subscriptions')
    .select(COLUMNS)
    .where('actorId', '=', actorId)
  if (endpoint) {
    query = query.where('endpoint', '=', endpoint)
  }
  query = accessToken
    ? query.where('accessToken', '=', accessToken)
    : query.where('accessToken', 'is', null)
  return query.orderBy('updatedAt', 'desc').limit(1).executeTakeFirst()
}

export const createPushSubscription = async (
  db: Db,
  {
    actorId,
    endpoint,
    p256dh,
    auth,
    alerts,
    policy,
    standard,
    accessToken
  }: CreatePushSubscriptionParams
): Promise<PushSubscription> => {
  const id = randomUUID()
  const now = new Date()
  const alertsValue = JSON.stringify(normalizeAlerts(alerts))
  const policyValue = policy ?? 'all'
  const standardValue = standard ?? false

  await db
    .insertInto('push_subscriptions')
    .values({
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
    .onConflict((oc) =>
      oc.column('endpoint').doUpdateSet({
        actorId,
        p256dh,
        auth,
        alerts: alertsValue,
        policy: policyValue,
        standard: standardValue,
        updatedAt: now,
        // Only overwrite the stored access token when a new one is supplied. A
        // tokenless re-subscribe of the same endpoint (e.g. a web-session
        // request) must not wipe a token a native client previously
        // registered, or its subsequent payloads would lose `access_token`.
        ...(accessToken ? { accessToken } : {})
      })
    )
    .execute()

  // The Mastodon spec allows one subscription per access token, and a
  // client re-subscribing after its push endpoint rotated (e.g. an iOS
  // device token refresh) sends a new endpoint. Drop the token's rows for
  // other endpoints so stale subscriptions don't accumulate.
  if (accessToken) {
    await db
      .deleteFrom('push_subscriptions')
      .where('actorId', '=', actorId)
      .where('accessToken', '=', accessToken)
      .where('endpoint', '!=', endpoint)
      .execute()
  }

  // Every notification is POSTed to each of an actor's subscriptions, so
  // their number is the server's per-notification fan-out. Keep the most
  // recently written ones (this row included) and drop the rest, rather
  // than refusing a new device because old ones never unsubscribed. The
  // actor's rows are listed newest first and the tail past the cap is
  // deleted; the cap is enforced on every write, so the list stays short
  // (SQLite also has no OFFSET without a LIMIT).
  const owned = await db
    .selectFrom('push_subscriptions')
    .select('id')
    .where('actorId', '=', actorId)
    .orderBy('updatedAt', 'desc')
    .orderBy('id', 'desc')
    .execute()
  const overflow = owned.slice(MAX_PUSH_SUBSCRIPTIONS_PER_ACTOR)
  if (overflow.length > 0) {
    await db
      .deleteFrom('push_subscriptions')
      .where(
        'id',
        'in',
        overflow.map(({ id }) => id)
      )
      .execute()
  }

  const row = await db
    .selectFrom('push_subscriptions')
    .select(COLUMNS)
    .where('endpoint', '=', endpoint)
    .limit(1)
    .executeTakeFirst()

  return fixPushSubscription(row!)
}

export const updatePushSubscription = async (
  db: Db,
  {
    actorId,
    endpoint,
    alerts,
    policy,
    accessToken
  }: UpdatePushSubscriptionParams
): Promise<PushSubscription | null> => {
  const existing = await findOwnedSubscription(db, {
    actorId,
    endpoint,
    accessToken
  })
  if (!existing) return null

  await db
    .updateTable('push_subscriptions')
    .set({
      updatedAt: new Date(),
      // Mastodon's "change types" PUT replaces the alert set: alert flags not
      // included in the request are treated as false, not merged with the
      // previous value. Callers pass `undefined` (not an empty object) when the
      // request carries no alerts at all, so a policy-only update leaves the
      // stored alerts untouched.
      ...(alerts !== undefined
        ? { alerts: JSON.stringify(normalizeAlerts(alerts)) }
        : {}),
      ...(policy !== undefined ? { policy } : {})
    })
    .where('id', '=', existing.id)
    .execute()

  const row = await db
    .selectFrom('push_subscriptions')
    .select(COLUMNS)
    .where('id', '=', existing.id)
    .limit(1)
    .executeTakeFirst()
  return row ? fixPushSubscription(row) : null
}

export const deletePushSubscription = async (
  db: Db,
  { endpoint, actorId }: DeletePushSubscriptionParams
): Promise<void> => {
  await db
    .deleteFrom('push_subscriptions')
    .where('endpoint', '=', endpoint)
    .where('actorId', '=', actorId)
    .execute()
}

export const getPushSubscriptionsForActor = async (
  db: Db,
  { actorId }: GetPushSubscriptionsForActorParams
): Promise<PushSubscription[]> => {
  const rows = await db
    .selectFrom('push_subscriptions')
    .select(COLUMNS)
    .where('actorId', '=', actorId)
    .execute()
  return rows.map(fixPushSubscription)
}

export const getPushSubscriptionForActor = async (
  db: Db,
  { actorId, accessToken }: GetPushSubscriptionForActorParams
): Promise<PushSubscription | null> => {
  const row = await findOwnedSubscription(db, { actorId, accessToken })
  return row ? fixPushSubscription(row) : null
}

export const pushSubscriptionQueries = {
  createPushSubscription,
  updatePushSubscription,
  deletePushSubscription,
  getPushSubscriptionsForActor,
  getPushSubscriptionForActor
}
