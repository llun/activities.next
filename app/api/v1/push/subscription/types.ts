import {
  PushAlerts,
  PushPolicy,
  PushSubscription
} from '@/lib/types/database/operations'

// Mastodon WebPushSubscription entity.
// https://docs.joinmastodon.org/entities/WebPushSubscription/
export interface WebPushSubscription {
  id: string
  endpoint: string
  standard: boolean
  alerts: PushAlerts
  server_key: string
}

const ALERT_KEYS: (keyof PushAlerts)[] = [
  'mention',
  'status',
  'reblog',
  'follow',
  'follow_request',
  'favourite',
  'poll',
  'update',
  'quote',
  'quoted_update',
  'admin.sign_up',
  'admin.report'
]

const PUSH_POLICIES: PushPolicy[] = ['all', 'followed', 'follower', 'none']

export const toWebPushSubscription = (
  subscription: PushSubscription,
  serverKey: string
): WebPushSubscription => ({
  id: subscription.id,
  endpoint: subscription.endpoint,
  standard: subscription.standard,
  alerts: subscription.alerts,
  server_key: serverKey
})

const toBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'on', 'yes'].includes(normalized)) return true
    if (['false', '0', 'off', 'no', ''].includes(normalized)) return false
  }
  return undefined
}

// Reads a value from a request body that may be either a nested object (JSON)
// or a flat object with Mastodon-style bracketed keys (form-encoded). For
// example `data[alerts][mention]` is read from `body['data[alerts][mention]']`
// when flat, or `body.data.alerts.mention` when nested.
const readValue = (body: Record<string, unknown>, path: string[]): unknown => {
  const flatKey =
    path[0] +
    path
      .slice(1)
      .map((p) => `[${p}]`)
      .join('')
  if (flatKey in body) return body[flatKey]

  let current: unknown = body
  for (const segment of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

export const parseAlertsInput = (
  body: Record<string, unknown>
): Partial<PushAlerts> => {
  const alerts: Partial<PushAlerts> = {}
  for (const key of ALERT_KEYS) {
    const value = toBoolean(readValue(body, ['data', 'alerts', key]))
    if (value !== undefined) alerts[key] = value
  }
  return alerts
}

export const parsePolicyInput = (
  body: Record<string, unknown>
): PushPolicy | undefined => {
  const value = readValue(body, ['data', 'policy'])
  if (
    typeof value === 'string' &&
    PUSH_POLICIES.includes(value as PushPolicy)
  ) {
    return value as PushPolicy
  }
  return undefined
}

export interface ParsedSubscribeInput {
  endpoint: string
  p256dh: string
  auth: string
  standard: boolean
  alerts: Partial<PushAlerts>
  policy?: PushPolicy
}

export const parseSubscribeInput = (
  body: Record<string, unknown>
): ParsedSubscribeInput | null => {
  const endpoint = readValue(body, ['subscription', 'endpoint'])
  const p256dh = readValue(body, ['subscription', 'keys', 'p256dh'])
  const auth = readValue(body, ['subscription', 'keys', 'auth'])

  if (
    typeof endpoint !== 'string' ||
    typeof p256dh !== 'string' ||
    typeof auth !== 'string' ||
    !endpoint ||
    !p256dh ||
    !auth
  ) {
    return null
  }

  try {
    // Validate the endpoint is a real URL, matching the legacy /subscribe route.
    new URL(endpoint)
  } catch {
    return null
  }

  return {
    endpoint,
    p256dh,
    auth,
    standard: toBoolean(readValue(body, ['subscription', 'standard'])) ?? false,
    alerts: parseAlertsInput(body),
    policy: parsePolicyInput(body)
  }
}
