import crypto from 'crypto'

import { getConfig } from '@/lib/config'

const KEY_LENGTH = 32

/**
 * Hash a password reset code for storage and lookup.
 *
 * The reset code is a high-entropy random token (see the request route) that
 * must be hashed deterministically so the stored hash can be used as a database
 * lookup key. We use scrypt — a memory-hard key derivation function — keyed
 * with the server secret as a pepper, instead of a plain fast hash such as
 * SHA-256. This keeps the hash deterministic for lookups while ensuring the
 * stored value resists brute-force and precomputation attacks if the database
 * is ever leaked.
 */
export const hashPasswordResetCode = (passwordResetCode: string): string => {
  const { secretPhase } = getConfig()
  return crypto
    .scryptSync(passwordResetCode, secretPhase, KEY_LENGTH)
    .toString('hex')
}
