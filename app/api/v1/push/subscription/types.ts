import {
  PushAlerts,
  PushPolicy,
  PushSubscription
} from '@/lib/types/database/operations'

// Mastodon WebPushSubscription entity.
// https://docs.joinmastodon.org/entities/WebPushSubscription/
//
// `policy` is not in the documented entity's attribute list, but it is included
// so a client can read back the push policy it saved (the GET response is
// otherwise the only way to observe the current setting). It is an additive,
// forward-compatible field and does not affect the documented fields.
export interface WebPushSubscription {
  id: string
  endpoint: string
  standard: boolean
  alerts: PushAlerts
  policy: PushPolicy
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
  policy: subscription.policy,
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

// Mastodon's "change types of notifications" (PUT) documents the policy as a
// top-level `policy` field, while "subscribe" (POST) nests it under
// `data[policy]`. Read either.
const readPolicyValue = (body: Record<string, unknown>): unknown =>
  readValue(body, ['policy']) ?? readValue(body, ['data', 'policy'])

export const parsePolicyInput = (
  body: Record<string, unknown>
): PushPolicy | undefined => {
  const value = readPolicyValue(body)
  if (
    typeof value === 'string' &&
    PUSH_POLICIES.includes(value as PushPolicy)
  ) {
    return value as PushPolicy
  }
  return undefined
}

// True when the request carries a `policy` value that is present but not one of
// the supported values. Callers reject these with 4xx instead of silently
// dropping the policy (which would otherwise leave it unchanged on PUT or fall
// back to the broader `all` default on POST).
export const hasInvalidPolicy = (body: Record<string, unknown>): boolean => {
  const value = readPolicyValue(body)
  if (value === undefined || value === null || value === '') return false
  return !(
    typeof value === 'string' && PUSH_POLICIES.includes(value as PushPolicy)
  )
}

// Web Push keys are base64-encoded: p256dh is a 65-byte ECDH public key
// (~87 chars) and auth is a 16-byte secret (~22 chars). Accept both base64url
// (`-`/`_`) and standard base64 (`+`/`/`) since native clients may send either,
// with optional padding. Validate the charset and a lenient minimum length so
// obviously malformed/truncated keys are rejected before they are stored,
// without being so strict that valid keys are refused.
const BASE64_PATTERN = /^[A-Za-z0-9_\-+/]+={0,2}$/
const MIN_P256DH_LENGTH = 80
const MIN_AUTH_LENGTH = 16

const isValidWebPushKey = (value: string, minLength: number): boolean =>
  value.length >= minLength && BASE64_PATTERN.test(value)

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

  if (
    !isValidWebPushKey(p256dh, MIN_P256DH_LENGTH) ||
    !isValidWebPushKey(auth, MIN_AUTH_LENGTH)
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
