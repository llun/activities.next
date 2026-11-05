// In-process limits for the app's own credential and mail routes, which do not
// go through better-auth's limiter, plus the per-email sign-in limit better-auth
// cannot express (it keys on `ip|path` before reading the body). Per-IP buckets
// exist only behind a trusted proxy header (`getTrustedClientRateLimitKey`,
// IPv6 collapsed to its /64); without one the request is not counted, because
// a spoofable key would only let a caller dodge the limit or lock out another
// address. Account- and email-keyed buckets always apply. Numbers follow
// Mastodon's Rack::Attack (config/initializers/rack_attack.rb on main):
// `throttle_login_attempts/email` 25 / 1 h, `throttle_password_resets/ip`
// 25 / 5 min, `throttle_email_confirmations/ip` 25 / 5 min,
// `throttle_password_change/account` 10 / 10 min and
// `throttle_sign_up_attempts/ip` 25 / 5 min; the per-account resend and
// email-change buckets keep the per-email `throttle_password_resets/email`
// 5 / 30 min shape.
import { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'

import { getTrustProxyIpHeadersConfig } from '@/lib/config/trustProxyIpHeaders'
import {
  WindowCounter,
  WindowCounterResult,
  createWindowCounter
} from '@/lib/services/gallery/lookups/rateLimit'
import { getTrustedClientRateLimitKey } from '@/lib/utils/getTrustedClientIp'

const FIVE_MINUTES_MS = 5 * 60_000
const TEN_MINUTES_MS = 10 * 60_000
const THIRTY_MINUTES_MS = 30 * 60_000
const ONE_HOUR_MS = 60 * 60_000
const MAX_KEYS = 10_000

export const SIGN_IN_EMAIL_LIMIT = 25
export const PASSWORD_RESET_LIMIT = 25
export const EMAIL_CONFIRMATION_ACCOUNT_LIMIT = 5
export const EMAIL_CONFIRMATION_IP_LIMIT = 25
export const EMAIL_CHANGE_LIMIT = 5
export const PASSWORD_CHANGE_LIMIT = 10
export const SIGN_UP_LIMIT = 25

const counter = (limit: number, windowMs: number) =>
  createWindowCounter({ limit, windowMs, maxKeys: MAX_KEYS })

// A full counter refuses new keys rather than evicting live ones, so a flood
// of random emails would stall sign-in for addresses not yet counted. Keys are
// 64-character digests, so 100,000 of them stay around 10 MB and raise that
// flood to 100,000 requests (behind a trusted proxy, the per-IP rule caps one
// source far below it).
const SIGN_IN_EMAIL_MAX_KEYS = 100_000
const signInByEmail = createWindowCounter({
  limit: SIGN_IN_EMAIL_LIMIT,
  windowMs: ONE_HOUR_MS,
  maxKeys: SIGN_IN_EMAIL_MAX_KEYS,
  // One source can mint unlimited emails, so eviction would let it flush a
  // victim's counter; refuse new keys instead, but only while per-IP limits
  // exist: without them one source could fill the map and stall sign-in for
  // every account, which is worse than the flush (the other buckets here key on
  // IPs or signed-in accounts and keep the default eviction).
  refuseNewKeysWhenFull: () => getTrustProxyIpHeadersConfig()
})
const passwordResetRequestByIp = counter(PASSWORD_RESET_LIMIT, FIVE_MINUTES_MS)
const passwordResetByIp = counter(PASSWORD_RESET_LIMIT, FIVE_MINUTES_MS)
const emailConfirmationByAccount = counter(
  EMAIL_CONFIRMATION_ACCOUNT_LIMIT,
  THIRTY_MINUTES_MS
)
const emailConfirmationByIp = counter(
  EMAIL_CONFIRMATION_IP_LIMIT,
  FIVE_MINUTES_MS
)
const emailChangeByAccount = counter(EMAIL_CHANGE_LIMIT, THIRTY_MINUTES_MS)
const passwordChangeByAccount = counter(PASSWORD_CHANGE_LIMIT, TEN_MINUTES_MS)
const signUpByIp = counter(SIGN_UP_LIMIT, FIVE_MINUTES_MS)

const consumeByIp = (
  byIp: WindowCounter,
  req: NextRequest | Request
): WindowCounterResult => {
  const key = getTrustedClientRateLimitKey(req)
  return key ? byIp.consume(key) : { allowed: true }
}

// Fixed-size key that holds no address: SHA-256 of the trimmed, lower-cased
// email. Exported for its test only.
export const signInEmailRateLimitKey = (email: string) =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex')

// Every attempt counts, as Mastodon's does, whatever its length: the digest
// keeps the key fixed size, so no length shortcut is needed (one would exempt
// any address longer than it that an account could hold).
export const checkSignInEmailRateLimit = (
  email: string
): WindowCounterResult => {
  return signInByEmail.consume(signInEmailRateLimitKey(email))
}

export const checkPasswordResetRequestRateLimit = (req: NextRequest) =>
  consumeByIp(passwordResetRequestByIp, req)

export const checkPasswordResetRateLimit = (req: NextRequest) =>
  consumeByIp(passwordResetByIp, req)

export const checkEmailConfirmationRateLimit = (
  req: NextRequest,
  accountId: string
): WindowCounterResult => {
  const byAccount = emailConfirmationByAccount.consume(accountId)
  if (!byAccount.allowed) return byAccount
  return consumeByIp(emailConfirmationByIp, req)
}

export const checkEmailChangeRateLimit = (accountId: string) =>
  emailChangeByAccount.consume(accountId)

export const checkPasswordChangeRateLimit = (accountId: string) =>
  passwordChangeByAccount.consume(accountId)

export const checkSignUpRateLimit = (req: NextRequest) =>
  consumeByIp(signUpByIp, req)

export const resetRouteRateLimitsForTests = () => {
  for (const c of [
    signInByEmail,
    passwordResetRequestByIp,
    passwordResetByIp,
    emailConfirmationByAccount,
    emailConfirmationByIp,
    emailChangeByAccount,
    passwordChangeByAccount,
    signUpByIp
  ]) {
    c.reset()
  }
}
