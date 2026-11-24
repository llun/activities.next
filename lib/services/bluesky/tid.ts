// Deterministic ATProto Timestamp Identifier (TID) record keys.
// Spec: 13 characters in the base32-sortable alphabet, encoding a 64-bit
// big-endian integer whose top bit is 0, next 53 bits are microseconds since
// the UNIX epoch, and bottom 10 bits are a clock identifier.
import { getHashFromString } from '@/lib/utils/getHashFromString'

export const TID_ALPHABET = '234567abcdefghijklmnopqrstuvwxyz'
// With bit 63 always 0, the top 5-bit group (bits 64..60) is 0..7 -> [234567ab].
export const TID_PATTERN = /^[234567ab][234567abcdefghijklmnopqrstuvwxyz]{12}$/

const TID_LENGTH = 13
const MAX_TIMESTAMP_US = (1n << 53n) - 1n
const CLOCK_ID_MASK = 0x3ff
const SUB_MS_US_MODULO = 1000

const encodeBase32Sortable = (value: bigint): string => {
  let result = ''
  let remaining = value
  for (let index = 0; index < TID_LENGTH; index++) {
    result = TID_ALPHABET[Number(remaining & 31n)] + result
    remaining >>= 5n
  }
  return result
}

/**
 * Derives a deterministic ATProto TID from a millisecond timestamp and a stable
 * identifier. The 53-bit microsecond field is `ms × 1000 + subMsUs` (clamped to
 * `[0, 2^53 - 1]`), where both the sub-millisecond offset (`0..999`) and the
 * 10-bit clock id (`0..1023`) come from independent slices of the SHA-256 hash
 * of `seed`. This preserves millisecond ordering while giving ~1,024,000
 * distinct keys per millisecond so retries reuse the same record key without
 * colliding with other statuses created in the same millisecond.
 */
export const deterministicTid = (createdAtMs: number, seed: string): string => {
  const hash = getHashFromString(seed)
  const clockId = BigInt(parseInt(hash.slice(0, 4), 16) & CLOCK_ID_MASK)
  const subMsUs = BigInt(parseInt(hash.slice(4, 12), 16) % SUB_MS_US_MODULO)

  let timestampUs = 0n
  if (Number.isFinite(createdAtMs) && createdAtMs > 0) {
    const rawUs = BigInt(Math.trunc(createdAtMs)) * 1000n + subMsUs
    timestampUs = rawUs > MAX_TIMESTAMP_US ? MAX_TIMESTAMP_US : rawUs
  }
  return encodeBase32Sortable((timestampUs << 10n) | clockId)
}
