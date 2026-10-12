import { CounterKey, parseCounterValue } from './counter'

describe('counter utils', () => {
  describe('parseCounterValue', () => {
    it('returns 0 for nullish and invalid values', () => {
      expect(parseCounterValue(undefined)).toBe(0)
      expect(parseCounterValue(null)).toBe(0)
      expect(parseCounterValue('not-a-number')).toBe(0)
      expect(parseCounterValue(Number.NaN)).toBe(0)
      expect(parseCounterValue(Number.POSITIVE_INFINITY)).toBe(0)
    })

    it('clamps to non-negative integer values', () => {
      expect(parseCounterValue(-1)).toBe(0)
      expect(parseCounterValue(0)).toBe(0)
      expect(parseCounterValue(3.9)).toBe(3)
      expect(parseCounterValue('12')).toBe(12)
      expect(parseCounterValue(9n)).toBe(9)
    })

    it('clamps values above Number.MAX_SAFE_INTEGER', () => {
      expect(parseCounterValue('9007199254740993')).toBe(
        Number.MAX_SAFE_INTEGER
      )
      expect(parseCounterValue(BigInt(Number.MAX_SAFE_INTEGER) + 10n)).toBe(
        Number.MAX_SAFE_INTEGER
      )
    })
  })

  describe('CounterKey', () => {
    it('builds expected key namespaces', () => {
      expect(CounterKey.totalStatus('actor')).toBe('total-status:actor')
      expect(CounterKey.totalFollowers('actor')).toBe('total-followers:actor')
      expect(CounterKey.totalFollowing('actor')).toBe('total-following:actor')
      expect(CounterKey.totalBlocking('actor')).toBe('total-blocking:actor')
      expect(CounterKey.totalBlockedBy('actor')).toBe('total-blocked-by:actor')
      expect(CounterKey.totalLike('status')).toBe('total-like:status')
      expect(CounterKey.totalReblog('status')).toBe('total-reblog:status')
      expect(CounterKey.totalReply('status')).toBe('total-reply:status')
      expect(CounterKey.mediaUsage('account')).toBe('media-usage:account')
      expect(CounterKey.totalMedia('account')).toBe('total-media:account')
      expect(CounterKey.fitnessUsage('account')).toBe('fitness-usage:account')
      expect(CounterKey.totalFitness('account')).toBe('total-fitness:account')
      expect(CounterKey.nodeinfoTotalUsers()).toBe('nodeinfo:total-users')
      expect(CounterKey.nodeinfoLocalPosts()).toBe('nodeinfo:local-posts')
      expect(CounterKey.nodeinfoActiveMonth()).toBe('nodeinfo:active-month')
      expect(CounterKey.nodeinfoActiveHalfyear()).toBe(
        'nodeinfo:active-halfyear'
      )
      expect(CounterKey.nodeinfoComputedAt()).toBe('nodeinfo:computed-at')
    })
  })
})
