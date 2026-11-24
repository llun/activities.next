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
  it('encodes top bit 0, 53-bit microsecond timestamp (with hashed sub-ms offset) and 10-bit hashed clock id', () => {
    const createdAt = 1_700_000_000_123
    const statusId = 'https://example.test/users/alice/statuses/1'
    const tid = deterministicTid(createdAt, statusId)

    expect(tid).toHaveLength(13)
    expect(tid).toMatch(TID_PATTERN)

    const hash = getHashFromString(statusId)
    const expectedClockId = BigInt(parseInt(hash.slice(0, 4), 16) & 0x3ff)
    const expectedSubMsUs = BigInt(parseInt(hash.slice(4, 12), 16) % 1000)

    const decoded = decodeTid(tid)
    expect(decoded >> 63n).toBe(0n)
    expect(decoded >> 10n).toBe(BigInt(createdAt) * 1000n + expectedSubMsUs)
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

  it('derives a sub-millisecond offset (0..999) from the hash while preserving millisecond order', () => {
    const createdAt = 1_700_000_000_123
    const clockIdOf = (seed: string) =>
      parseInt(getHashFromString(seed).slice(0, 4), 16) & 0x3ff

    // Find two distinct seeds that collide on the 10-bit clock id.
    const seenByClock = new Map<number, string>()
    let pair: [string, string] | null = null
    for (let i = 0; i < 10_000 && !pair; i++) {
      const candidate = `https://example.test/users/alice/statuses/collide-${i}`
      const clock = clockIdOf(candidate)
      const prev = seenByClock.get(clock)
      if (prev) {
        pair = [prev, candidate]
      } else {
        seenByClock.set(clock, candidate)
      }
    }
    expect(pair).not.toBeNull()
    const [seedA, seedB] = pair!

    const tidA = deterministicTid(createdAt, seedA)
    const tidB = deterministicTid(createdAt, seedB)
    const tsUsA = decodeTid(tidA) >> 10n
    const tsUsB = decodeTid(tidB) >> 10n

    expect(tsUsA / 1000n).toBe(BigInt(createdAt))
    expect(tsUsB / 1000n).toBe(BigInt(createdAt))
    expect(tsUsA % 1000n).toBeGreaterThanOrEqual(0n)
    expect(tsUsA % 1000n).toBeLessThan(1000n)
    expect(tsUsB % 1000n).toBeGreaterThanOrEqual(0n)
    expect(tsUsB % 1000n).toBeLessThan(1000n)
    // Colliding on the 10-bit clock id alone does not collide the TID.
    expect(tidA).not.toBe(tidB)
    expect(tsUsA % 1000n).not.toBe(tsUsB % 1000n)

    // Millisecond ordering holds across arbitrary seeds regardless of sub-ms offset.
    const nextMsA = deterministicTid(createdAt + 1, seedA)
    const nextMsB = deterministicTid(createdAt + 1, seedB)
    expect(tidA < nextMsB).toBe(true)
    expect(tidB < nextMsA).toBe(true)
  })
})
