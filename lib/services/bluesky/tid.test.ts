import {
  TID_ALPHABET,
  TID_PATTERN,
  deterministicTid
} from '@/lib/services/bluesky/tid'
import { getHashFromString } from '@/lib/utils/getHashFromString'

const decodeTid = (tid: string): bigint => {
  let value = 0n
  for (const ch of tid) {
    const digit = TID_ALPHABET.indexOf(ch)
    if (digit === -1) throw new Error(`Invalid TID char: ${ch}`)
    value = (value << 5n) | BigInt(digit)
  }
  return value
}

describe('deterministicTid', () => {
  it('encodes top bit 0, 53-bit microsecond timestamp and 10-bit hashed clock id', () => {
    const createdAt = 1_700_000_000_123
    const statusId = 'https://example.test/users/alice/statuses/1'
    const tid = deterministicTid(createdAt, statusId)

    expect(tid).toHaveLength(13)
    expect(tid).toMatch(TID_PATTERN)

    const decoded = decodeTid(tid)
    expect(decoded >> 63n).toBe(0n)
    expect(decoded >> 10n).toBe(BigInt(createdAt) * 1000n)
    const expectedClockId = BigInt(
      parseInt(getHashFromString(statusId).slice(0, 4), 16) & 0x3ff
    )
    expect(decoded & 0x3ffn).toBe(expectedClockId)
  })

  it('is deterministic for the same inputs and sorts chronologically', () => {
    const statusId = 'https://example.test/users/alice/statuses/42'
    const a = deterministicTid(1_700_000_000_000, statusId)
    const b = deterministicTid(1_700_000_000_000, statusId)
    const later = deterministicTid(1_700_000_000_001, statusId)

    expect(a).toBe(b)
    expect(a < later).toBe(true)
  })

  it('clamps out-of-range and non-finite timestamps to valid TIDs', () => {
    const seed = 'https://example.test/users/alice/statuses/edge'
    for (const ts of [-100, 0, Number.NaN, Number.POSITIVE_INFINITY, 1e16]) {
      const tid = deterministicTid(ts, seed)
      expect(tid).toHaveLength(13)
      expect(tid).toMatch(TID_PATTERN)
      expect(decodeTid(tid) >> 63n).toBe(0n)
    }

    expect(decodeTid(deterministicTid(-100, seed)) >> 10n).toBe(0n)
    expect(decodeTid(deterministicTid(1e16, seed)) >> 10n).toBe(
      (1n << 53n) - 1n
    )
  })
})
