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
 * identifier. The timestamp becomes the 53-bit microsecond field (ms × 1000,
 * clamped to `[0, 2^53 - 1]`) and the 10-bit clock id comes from a SHA-256 hash
 * of `seed`, so retries for the same status reuse the same record key.
 */
export const deterministicTid = (createdAtMs: number, seed: string): string => {
  let timestampUs = 0n
  if (Number.isFinite(createdAtMs) && createdAtMs > 0) {
    const rawUs = BigInt(Math.trunc(createdAtMs)) * 1000n
    timestampUs = rawUs > MAX_TIMESTAMP_US ? MAX_TIMESTAMP_US : rawUs
  }
  const clockId = BigInt(
    parseInt(getHashFromString(seed).slice(0, 4), 16) & CLOCK_ID_MASK
  )
  return encodeBase32Sortable((timestampUs << 10n) | clockId)
}
