import { Database } from '@/lib/database/types'

import { getSevenDayHistory, getTagHistory } from './tagHistory'

const DAY_MS = 86_400_000

describe('getSevenDayHistory', () => {
  it('zero-fills seven newest-first UTC day buckets around the provided points', () => {
    // 1_700_006_400_000 is an exact UTC day start (divisible by DAY_MS).
    const todayBucketMs = 1_700_006_400_000
    const history = getSevenDayHistory(todayBucketMs, [
      { dayBucketMs: todayBucketMs, uses: 3, accounts: 2 },
      { dayBucketMs: todayBucketMs - 2 * DAY_MS, uses: 1, accounts: 1 }
    ])

    expect(history).toHaveLength(7)
    expect(history[0]).toEqual({
      day: String(todayBucketMs / 1000),
      uses: '3',
      accounts: '2'
    })
    expect(history[1]).toEqual({
      day: String((todayBucketMs - DAY_MS) / 1000),
      uses: '0',
      accounts: '0'
    })
    expect(history[2]).toEqual({
      day: String((todayBucketMs - 2 * DAY_MS) / 1000),
      uses: '1',
      accounts: '1'
    })
    expect(
      history
        .slice(3)
        .every((bucket) => bucket.uses === '0' && bucket.accounts === '0')
    ).toBe(true)
  })
})

describe('getTagHistory', () => {
  it('normalizes the requested name before reading the daily-history map', async () => {
    const todayBucketMs = Math.floor(Date.now() / DAY_MS) * DAY_MS
    const getTagDailyHistory = vi
      .fn()
      .mockResolvedValue(
        new Map([
          ['running', [{ dayBucketMs: todayBucketMs, uses: 5, accounts: 4 }]]
        ])
      )
    const database = { getTagDailyHistory } as unknown as Database

    const history = await getTagHistory(database, '#Running')

    expect(getTagDailyHistory).toHaveBeenCalledWith({
      names: ['#Running'],
      days: 7
    })
    expect(history[0]).toEqual({
      day: String(todayBucketMs / 1000),
      uses: '5',
      accounts: '4'
    })
  })

  it('returns a zero-filled week for a tag with no usage', async () => {
    const database = {
      getTagDailyHistory: vi.fn().mockResolvedValue(new Map())
    } as unknown as Database

    const history = await getTagHistory(database, 'quiet')

    expect(history).toHaveLength(7)
    expect(
      history.every((bucket) => bucket.uses === '0' && bucket.accounts === '0')
    ).toBe(true)
  })
})
