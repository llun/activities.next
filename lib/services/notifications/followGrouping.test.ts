import { followGroupKey } from '@/lib/services/notifications/followGrouping'

const DAY = 24 * 60 * 60 * 1000

describe('#followGroupKey', () => {
  it('buckets timestamps on the same UTC day into one key', () => {
    const dayStart = 20000 * DAY
    expect(followGroupKey(dayStart)).toBe('follow:20000')
    expect(followGroupKey(dayStart + DAY - 1)).toBe('follow:20000')
  })

  it('uses a different key on the next day', () => {
    const dayStart = 20000 * DAY
    expect(followGroupKey(dayStart + DAY)).toBe('follow:20001')
  })
})
