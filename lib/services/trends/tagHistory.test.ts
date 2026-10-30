import { Database } from '@/lib/database/types'

import { getTagHistory } from './tagHistory'

const DAY_MS = 86_400_000

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
