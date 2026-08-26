import { Database } from '@/lib/database/types'
import {
  ACTOR_PUBLIC_STATUS_COUNT_TTL_MS,
  MAX_CACHED_ACTORS,
  getActorPublicStatusCountCacheSizeForTests,
  getCachedActorPublicStatusCount,
  resetActorPublicStatusCountCacheForTests
} from '@/lib/services/statuses/actorPublicStatusCount'

const ACTOR_ID = 'https://example.com/users/test'

// Only getActorStatusesCount is exercised; the cache never touches the rest of
// the Database surface. Each call returns a fresh object, so every case gets its
// own key in the cache's WeakMap and cannot see another's entry.
const mockDatabase = (count: number | number[]) => {
  const counts = Array.isArray(count) ? [...count] : null
  const getActorStatusesCount = vi.fn(async () =>
    counts ? (counts.shift() ?? 0) : (count as number)
  )
  return {
    database: { getActorStatusesCount } as unknown as Database,
    getActorStatusesCount
  }
}

describe('getCachedActorPublicStatusCount', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetActorPublicStatusCountCacheForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('queries the database on the first call for the public count only', async () => {
    const { database, getActorStatusesCount } = mockDatabase(1938)

    expect(await getCachedActorPublicStatusCount(database, ACTOR_ID)).toBe(1938)
    expect(getActorStatusesCount).toHaveBeenCalledExactlyOnceWith({
      actorId: ACTOR_ID,
      publicOnly: true
    })
  })

  it('serves a repeat call from the cache without querying again', async () => {
    const { database, getActorStatusesCount } = mockDatabase([1938, 2000])

    await getCachedActorPublicStatusCount(database, ACTOR_ID)
    expect(await getCachedActorPublicStatusCount(database, ACTOR_ID)).toBe(1938)
    expect(getActorStatusesCount).toHaveBeenCalledTimes(1)
  })

  it('keeps serving the cached count until its TTL elapses', async () => {
    const { database, getActorStatusesCount } = mockDatabase([1938, 2000])

    await getCachedActorPublicStatusCount(database, ACTOR_ID)
    vi.advanceTimersByTime(ACTOR_PUBLIC_STATUS_COUNT_TTL_MS - 1)

    expect(await getCachedActorPublicStatusCount(database, ACTOR_ID)).toBe(1938)
    expect(getActorStatusesCount).toHaveBeenCalledTimes(1)
  })

  it('re-queries once the TTL elapses', async () => {
    const { database, getActorStatusesCount } = mockDatabase([1938, 2000])

    expect(await getCachedActorPublicStatusCount(database, ACTOR_ID)).toBe(1938)
    vi.advanceTimersByTime(ACTOR_PUBLIC_STATUS_COUNT_TTL_MS + 1)

    expect(await getCachedActorPublicStatusCount(database, ACTOR_ID)).toBe(2000)
    expect(getActorStatusesCount).toHaveBeenCalledTimes(2)
  })

  it('caches each actor separately on one database', async () => {
    const { database, getActorStatusesCount } = mockDatabase([10, 20])
    const otherActorId = 'https://example.com/users/other'

    expect(await getCachedActorPublicStatusCount(database, ACTOR_ID)).toBe(10)
    expect(await getCachedActorPublicStatusCount(database, otherActorId)).toBe(
      20
    )
    expect(await getCachedActorPublicStatusCount(database, ACTOR_ID)).toBe(10)
    expect(await getCachedActorPublicStatusCount(database, otherActorId)).toBe(
      20
    )
    expect(getActorStatusesCount).toHaveBeenCalledTimes(2)
  })

  it('caches per database instance', async () => {
    const first = mockDatabase(10)
    const second = mockDatabase(20)

    expect(
      await getCachedActorPublicStatusCount(first.database, ACTOR_ID)
    ).toBe(10)
    expect(
      await getCachedActorPublicStatusCount(second.database, ACTOR_ID)
    ).toBe(20)

    expect(first.getActorStatusesCount).toHaveBeenCalledTimes(1)
    expect(second.getActorStatusesCount).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failure, so the next call retries', async () => {
    const { database, getActorStatusesCount } = mockDatabase(1938)
    getActorStatusesCount.mockRejectedValueOnce(new Error('database is down'))

    await expect(
      getCachedActorPublicStatusCount(database, ACTOR_ID)
    ).rejects.toThrow('database is down')
    expect(await getCachedActorPublicStatusCount(database, ACTOR_ID)).toBe(1938)
    expect(getActorStatusesCount).toHaveBeenCalledTimes(2)
  })

  it('bounds how many actors one database caches', async () => {
    const { database } = mockDatabase(1)

    for (let index = 0; index < MAX_CACHED_ACTORS + 88; index++) {
      await getCachedActorPublicStatusCount(
        database,
        `https://example.com/users/actor-${index}`
      )
    }

    expect(getActorPublicStatusCountCacheSizeForTests(database)).toBe(
      MAX_CACHED_ACTORS
    )
  })
})
