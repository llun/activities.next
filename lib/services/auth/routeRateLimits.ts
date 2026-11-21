// Database-backed limits for the app's own credential and mail routes, which do
// not go through better-auth's limiter, plus the per-email sign-in limit
// better-auth cannot express (it keys on `ip|path` before reading the body).
// The counters live in better-auth's `rateLimit` table, so every server
// instance shares them and a scale event does not reset them. Keys are
// `app:<bucket>:<digest>`: the prefix keeps them out of better-auth's `ip|path`
// namespace, the window-end `lastRequest` keeps a live row out of better-auth's
// unfiltered expiry prune (the auth adapter also skips `app:` rows there), and
// the digest keeps raw emails, IPs and account ids out of the table.
//
// Per-IP buckets exist only behind a trusted proxy header
// (`getTrustedClientRateLimitKey`, IPv6 collapsed to its /64); without one the
// request is not counted, because a spoofable key would only let a caller dodge
// the limit or lock out another address. Account- and email-keyed buckets
// always apply. Numbers follow Mastodon's Rack::Attack
// (config/initializers/rack_attack.rb on main): `throttle_login_attempts/email`
// 25 / 1 h, `throttle_password_resets/ip` 25 / 5 min,
// `throttle_email_confirmations/ip` 25 / 5 min,
// `throttle_password_change/account` 10 / 10 min and
// `throttle_sign_up_attempts/ip` 25 / 5 min; the per-account resend and
// email-change buckets keep the per-email `throttle_password_resets/email`
// 5 / 30 min shape.
//
// A database error propagates: the routes already answer 500 when the database
// is unavailable, and better-auth fails closed on a limiter error, so the
// limits fail closed too rather than silently disappearing.
import { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'

import { getDatabase } from '@/lib/database'
import { APP_RATE_LIMIT_KEY_PREFIX } from '@/lib/database/domains/rateLimit/types'
import type { WindowCounterResult } from '@/lib/services/gallery/lookups/rateLimit'
import { getTrustedClientRateLimitKey } from '@/lib/utils/getTrustedClientIp'

const FIVE_MINUTES_MS = 5 * 60_000
const TEN_MINUTES_MS = 10 * 60_000
const THIRTY_MINUTES_MS = 30 * 60_000
const ONE_HOUR_MS = 60 * 60_000

// Every row this module writes starts with this prefix. It keeps the app's
// buckets out of better-auth's `ip|path` keys and lets the cleanup delete only
// its own expired rows. The auth adapter's prune for the `rateLimit` model also
// skips these rows, so better-auth's unfiltered expiry delete cannot take them.
export { APP_RATE_LIMIT_KEY_PREFIX }

export const SIGN_IN_EMAIL_LIMIT = 25
export const PASSWORD_RESET_LIMIT = 25
export const EMAIL_CONFIRMATION_ACCOUNT_LIMIT = 5
export const EMAIL_CONFIRMATION_IP_LIMIT = 25
export const EMAIL_CHANGE_LIMIT = 5
export const PASSWORD_CHANGE_LIMIT = 10
export const SIGN_UP_LIMIT = 25

const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex')

const bucketKey = (bucket: string, digestValue: string) =>
  `${APP_RATE_LIMIT_KEY_PREFIX}${bucket}:${digestValue}`

const requireDatabase = () => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Database not initialized')
  }
  return database
}

const consumeDigest = async (
  bucket: string,
  digestValue: string,
  limit: number,
  windowMs: number
): Promise<WindowCounterResult> => {
  const result = await requireDatabase().consumeRateLimit({
    key: bucketKey(bucket, digestValue),
    keyPrefix: APP_RATE_LIMIT_KEY_PREFIX,
    limit,
    windowMs
  })
  return result.allowed
    ? { allowed: true }
    : { allowed: false, retryAfterSeconds: result.retryAfterSeconds }
}

const consumeValue = (
  bucket: string,
  value: string,
  limit: number,
  windowMs: number
) => consumeDigest(bucket, digest(value), limit, windowMs)

// `async` so a synchronous throw from `getTrustedClientRateLimitKey` (an
// invalid `ACTIVITIES_TRUST_PROXY_IP_HEADER`) becomes a rejection the call
// sites' `.catch` sees, instead of escaping before it is attached.
const consumeByIp = async (
  bucket: string,
  limit: number,
  windowMs: number,
  req: NextRequest | Request
): Promise<WindowCounterResult> => {
  const key = getTrustedClientRateLimitKey(req)
  return key ? consumeValue(bucket, key, limit, windowMs) : { allowed: true }
}

// Fixed-size key that holds no address: SHA-256 of the trimmed, lower-cased
// email. Exported for its test only.
export const signInEmailRateLimitKey = (email: string) =>
  digest(email.trim().toLowerCase())

// Every attempt counts, as Mastodon's does, whatever its length: the digest
// keeps the key fixed size, so no length shortcut is needed (one would exempt
// any address longer than it that an account could hold).
export const checkSignInEmailRateLimit = (
  email: string
): Promise<WindowCounterResult> =>
  consumeDigest(
    'sign-in-email',
    signInEmailRateLimitKey(email),
    SIGN_IN_EMAIL_LIMIT,
    ONE_HOUR_MS
  )

export const checkPasswordResetRequestRateLimit = async (req: NextRequest) =>
  consumeByIp(
    'password-reset-request-ip',
    PASSWORD_RESET_LIMIT,
    FIVE_MINUTES_MS,
    req
  )

export const checkPasswordResetRateLimit = async (req: NextRequest) =>
  consumeByIp('password-reset-ip', PASSWORD_RESET_LIMIT, FIVE_MINUTES_MS, req)

export const checkEmailConfirmationRateLimit = async (
  req: NextRequest,
  accountId: string
): Promise<WindowCounterResult> => {
  const byAccount = await consumeValue(
    'email-confirmation-account',
    accountId,
    EMAIL_CONFIRMATION_ACCOUNT_LIMIT,
    THIRTY_MINUTES_MS
  )
  if (!byAccount.allowed) return byAccount
  return consumeByIp(
    'email-confirmation-ip',
    EMAIL_CONFIRMATION_IP_LIMIT,
    FIVE_MINUTES_MS,
    req
  )
}

// The per-IP half alone, for the code-based email-change confirmation: it has
// no account to key on (the link may be opened signed out), so the code is the
// credential and the address is the only bucket.
export const checkEmailConfirmationIpRateLimit = (req: NextRequest) =>
  consumeByIp(emailConfirmationByIp, req)

export const checkEmailChangeRateLimit = (accountId: string) =>
  consumeValue(
    'email-change-account',
    accountId,
    EMAIL_CHANGE_LIMIT,
    THIRTY_MINUTES_MS
  )

export const checkPasswordChangeRateLimit = (accountId: string) =>
  consumeValue(
    'password-change-account',
    accountId,
    PASSWORD_CHANGE_LIMIT,
    TEN_MINUTES_MS
  )

export const checkSignUpRateLimit = async (req: NextRequest) =>
  consumeByIp('sign-up-ip', SIGN_UP_LIMIT, FIVE_MINUTES_MS, req)

export const resetRouteRateLimitsForTests = async () => {
  const database = getDatabase()
  if (!database) return
  await database.deleteRateLimits({ keyPrefix: APP_RATE_LIMIT_KEY_PREFIX })
}
