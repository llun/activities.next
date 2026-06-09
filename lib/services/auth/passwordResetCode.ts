import crypto from 'crypto'

import { getConfig } from '@/lib/config'

/**
 * Hash a password reset code for storage and lookup.
 *
 * The reset code is a high-entropy random token (crypto.randomBytes(32), 256
 * bits) — not a user-chosen password — so it cannot be brute-forced even if the
 * database leaks. A slow password KDF (bcrypt/scrypt/argon2) is therefore
 * unnecessary here and, on this unauthenticated and unthrottled endpoint, would
 * be a denial-of-service amplification vector.
 *
 * We hash the code with HMAC-SHA256 keyed with the server secret
 * (`secretPhase`). This is deterministic, so the stored hash can be used as a
 * database lookup key, and keying it with the server secret means a leaked
 * database alone cannot be used to forge a valid reset code.
 */
export const hashPasswordResetCode = (passwordResetCode: string): string =>
  crypto
    .createHmac('sha256', getConfig().secretPhase)
    .update(passwordResetCode)
    .digest('hex')
