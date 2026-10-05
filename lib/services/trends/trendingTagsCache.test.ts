import { Database } from '@/lib/database/types'

import {
  TRENDING_TAGS_CACHE_TTL_MS,
  getCachedTrendingTags,
  resetTrendingTagsCacheForTests
} from './trendingTagsCache'

const makeDatabase = () => {
  const getTrendingTags = vi.fn(async () => [
    { name: 'alpha', uses: 3, accounts: 2 }
  ])
  const getTagDailyHistory = vi.fn(async () => new Map())
  return {
    database: { getTrendingTags, getTagDailyHistory } as unknown as Database,
    getTrendingTags,
    getTagDailyHistory
  }
}

const params = { days: 7, limit: 10, offset: 0 }

describe('getCachedTrendingTags', () => {
  beforeEach(() => resetTrendingTagsCacheForTests())

  it('queries once for identical requests inside the TTL, then refreshes', async () => {
    const { database, getTrendingTags } = makeDatabase()
    const t0 = 1_000_000

    await getCachedTrendingTags(database, params, t0)
    await getCachedTrendingTags(database, params, t0 + 1000)
    expect(getTrendingTags).toHaveBeenCalledTimes(1)

    await getCachedTrendingTags(
      database,
      params,
      t0 + TRENDING_TAGS_CACHE_TTL_MS + 1
    )
    expect(getTrendingTags).toHaveBeenCalledTimes(2)
  })

  it('shares one in-flight query between concurrent requests', async () => {
    const { database, getTrendingTags } = makeDatabase()
    await Promise.all(
      Array.from({ length: 20 }, () => getCachedTrendingTags(database, params))
    )
    expect(getTrendingTags).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failed load', async () => {
    const { database, getTrendingTags } = makeDatabase()
    getTrendingTags.mockRejectedValueOnce(new Error('db down'))

    await expect(getCachedTrendingTags(database, params)).rejects.toThrow(
      'db down'
    )
    await expect(getCachedTrendingTags(database, params)).resolves.toEqual(
      expect.objectContaining({
        trendingTags: [{ name: 'alpha', uses: 3, accounts: 2 }]
      })
    )
  })

  it('keeps distinct pages separate and bounds how many it remembers', async () => {
    const { database, getTrendingTags } = makeDatabase()
    for (let offset = 0; offset < 200; offset++) {
      await getCachedTrendingTags(database, { ...params, offset })
    }
    expect(getTrendingTags).toHaveBeenCalledTimes(200)

    // The oldest page was evicted, so it is queried again.
    await getCachedTrendingTags(database, { ...params, offset: 0 })
    expect(getTrendingTags).toHaveBeenCalledTimes(201)
    // The newest page is still cached.
    await getCachedTrendingTags(database, { ...params, offset: 199 })
    expect(getTrendingTags).toHaveBeenCalledTimes(201)
  })
})
