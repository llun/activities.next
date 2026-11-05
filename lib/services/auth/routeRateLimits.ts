// In-process limits for the app's own credential and mail routes, which do not
// go through better-auth's limiter. Per-IP buckets exist only behind a trusted
// proxy header (`getTrustedClientRateLimitKey`, IPv6 collapsed to its /64);
// without one the request is not counted, because a spoofable key would only
// let a caller dodge the limit or lock out another address. Account-keyed
// buckets always apply. Numbers follow Mastodon's Rack::Attack where it has
// one: `throttle_password_resets` 5 / 30 min per IP and
// `throttle_sign_up_attempts` 25 / 5 min per IP.
import { NextRequest } from 'next/server'

import {
  WindowCounter,
  WindowCounterResult,
  createWindowCounter
} from '@/lib/services/gallery/lookups/rateLimit'
import { getTrustedClientRateLimitKey } from '@/lib/utils/getTrustedClientIp'

const FIVE_MINUTES_MS = 5 * 60_000
const THIRTY_MINUTES_MS = 30 * 60_000
const MAX_KEYS = 10_000

export const PASSWORD_RESET_LIMIT = 5
export const EMAIL_CONFIRMATION_LIMIT = 5
export const EMAIL_CHANGE_LIMIT = 5
export const PASSWORD_CHANGE_LIMIT = 5
export const SIGN_UP_LIMIT = 25

const counter = (limit: number, windowMs: number) =>
  createWindowCounter({ limit, windowMs, maxKeys: MAX_KEYS })

const passwordResetRequestByIp = counter(
  PASSWORD_RESET_LIMIT,
  THIRTY_MINUTES_MS
)
const passwordResetByIp = counter(PASSWORD_RESET_LIMIT, THIRTY_MINUTES_MS)
const emailConfirmationByAccount = counter(
  EMAIL_CONFIRMATION_LIMIT,
  THIRTY_MINUTES_MS
)
const emailConfirmationByIp = counter(
  EMAIL_CONFIRMATION_LIMIT,
  THIRTY_MINUTES_MS
)
const emailChangeByAccount = counter(EMAIL_CHANGE_LIMIT, THIRTY_MINUTES_MS)
const passwordChangeByAccount = counter(PASSWORD_CHANGE_LIMIT, FIVE_MINUTES_MS)
const signUpByIp = counter(SIGN_UP_LIMIT, FIVE_MINUTES_MS)

const consumeByIp = (
  byIp: WindowCounter,
  req: NextRequest
): WindowCounterResult => {
  const key = getTrustedClientRateLimitKey(req)
  return key ? byIp.consume(key) : { allowed: true }
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
