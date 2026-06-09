import crypto from 'crypto'
import { promisify } from 'util'

import { getConfig } from '@/lib/config'

const KEY_LENGTH = 32

const scrypt = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number
) => Promise<Buffer>

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
 *
 * The asynchronous `crypto.scrypt` is used (rather than `scryptSync`) so the
 * memory-hard computation runs on libuv's thread pool instead of blocking the
 * Node.js event loop under concurrent requests.
 */
export const hashPasswordResetCode = async (
  passwordResetCode: string
): Promise<string> => {
  const { secretPhase } = getConfig()
  const derivedKey = await scrypt(passwordResetCode, secretPhase, KEY_LENGTH)
  return derivedKey.toString('hex')
}
