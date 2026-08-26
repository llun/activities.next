import { Database } from '@/lib/database/types'
import {
  ACTOR_PUBLIC_STATUSES_COUNT_TTL_MS,
  MAX_CACHED_ACTORS,
  getActorPublicStatusesCountCachedActorIdsForTests,
  getCachedActorPublicStatusesCount,
  resetActorPublicStatusesCountCacheForTests
} from '@/lib/services/statuses/actorPublicStatusesCount'

const ACTOR_ID = 'https://example.com/users/test'
const actorId = (index: number) => `https://example.com/users/actor-${index}`

// Fills the cache with `count` distinct actors, oldest first, so a test can then
// assert which of them a further insert evicts.
const cacheActors = async (database: Database, count: number) => {
  for (let index = 0; index < count; index++) {
    await getCachedActorPublicStatusesCount(database, actorId(index))
  }
}

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

describe('getCachedActorPublicStatusesCount', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetActorPublicStatusesCountCacheForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('queries the database on the first call for the public count only', async () => {
    const { database, getActorStatusesCount } = mockDatabase(1938)

    expect(await getCachedActorPublicStatusesCount(database, ACTOR_ID)).toBe(
      1938
    )
    expect(getActorStatusesCount).toHaveBeenCalledExactlyOnceWith({
      actorId: ACTOR_ID,
      publicOnly: true
    })
  })

  it('serves a repeat call from the cache without querying again', async () => {
    const { database, getActorStatusesCount } = mockDatabase([1938, 2000])

    await getCachedActorPublicStatusesCount(database, ACTOR_ID)
    expect(await getCachedActorPublicStatusesCount(database, ACTOR_ID)).toBe(
      1938
    )
    expect(getActorStatusesCount).toHaveBeenCalledTimes(1)
  })

  it('keeps serving the cached count until its TTL elapses', async () => {
    const { database, getActorStatusesCount } = mockDatabase([1938, 2000])

    await getCachedActorPublicStatusesCount(database, ACTOR_ID)
    vi.advanceTimersByTime(ACTOR_PUBLIC_STATUSES_COUNT_TTL_MS - 1)

    expect(await getCachedActorPublicStatusesCount(database, ACTOR_ID)).toBe(
      1938
    )
    expect(getActorStatusesCount).toHaveBeenCalledTimes(1)
  })

  it('re-queries once the TTL elapses', async () => {
    const { database, getActorStatusesCount } = mockDatabase([1938, 2000])

    expect(await getCachedActorPublicStatusesCount(database, ACTOR_ID)).toBe(
      1938
    )
    vi.advanceTimersByTime(ACTOR_PUBLIC_STATUSES_COUNT_TTL_MS + 1)

    expect(await getCachedActorPublicStatusesCount(database, ACTOR_ID)).toBe(
      2000
    )
    expect(getActorStatusesCount).toHaveBeenCalledTimes(2)
  })

  it('caches each actor separately on one database', async () => {
    const { database, getActorStatusesCount } = mockDatabase([10, 20])
    const otherActorId = 'https://example.com/users/other'

    expect(await getCachedActorPublicStatusesCount(database, ACTOR_ID)).toBe(10)
    expect(
      await getCachedActorPublicStatusesCount(database, otherActorId)
    ).toBe(20)
    expect(await getCachedActorPublicStatusesCount(database, ACTOR_ID)).toBe(10)
    expect(
      await getCachedActorPublicStatusesCount(database, otherActorId)
    ).toBe(20)
    expect(getActorStatusesCount).toHaveBeenCalledTimes(2)
  })

  it('caches per database instance', async () => {
    const first = mockDatabase(10)
    const second = mockDatabase(20)

    expect(
      await getCachedActorPublicStatusesCount(first.database, ACTOR_ID)
    ).toBe(10)
    expect(
      await getCachedActorPublicStatusesCount(second.database, ACTOR_ID)
    ).toBe(20)

    expect(first.getActorStatusesCount).toHaveBeenCalledTimes(1)
    expect(second.getActorStatusesCount).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failure, so the next call retries', async () => {
    const { database, getActorStatusesCount } = mockDatabase(1938)
    getActorStatusesCount.mockRejectedValueOnce(new Error('database is down'))

    await expect(
      getCachedActorPublicStatusesCount(database, ACTOR_ID)
    ).rejects.toThrow('database is down')
    expect(await getCachedActorPublicStatusesCount(database, ACTOR_ID)).toBe(
      1938
    )
    expect(getActorStatusesCount).toHaveBeenCalledTimes(2)
  })

  it('bounds how many actors one database caches', async () => {
    const { database } = mockDatabase(1)

    await cacheActors(database, MAX_CACHED_ACTORS + 88)

    expect(
      getActorPublicStatusesCountCachedActorIdsForTests(database)
    ).toHaveLength(MAX_CACHED_ACTORS)
  })

  it('evicts the actor cached longest ago, not an arbitrary one', async () => {
    const { database } = mockDatabase(1)

    await cacheActors(database, MAX_CACHED_ACTORS)
    await getCachedActorPublicStatusesCount(database, ACTOR_ID)

    const cached = getActorPublicStatusesCountCachedActorIdsForTests(database)
    expect(cached).not.toContain(actorId(0))
    expect(cached).toContain(actorId(1))
    expect(cached.at(-1)).toBe(ACTOR_ID)
  })

  // These two refresh an actor from the MIDDLE of the map, never the oldest.
  // Refreshing the oldest is the degenerate case: an implementation that
  // wrongly evicts the oldest and then re-inserts the refreshed actor lands on
  // the same answer, so it proves nothing about the touch branch.
  it('refreshing an expired actor moves it clear of the next eviction', async () => {
    const { database } = mockDatabase(1)

    await cacheActors(database, MAX_CACHED_ACTORS)
    vi.advanceTimersByTime(ACTOR_PUBLIC_STATUSES_COUNT_TTL_MS + 1)
    await getCachedActorPublicStatusesCount(database, actorId(3))
    await getCachedActorPublicStatusesCount(database, ACTOR_ID)

    const cached = getActorPublicStatusesCountCachedActorIdsForTests(database)
    expect(cached).toContain(actorId(3))
    expect(cached).not.toContain(actorId(0))
  })

  it('refreshing an expired actor at capacity evicts nobody', async () => {
    const { database } = mockDatabase(1)

    await cacheActors(database, MAX_CACHED_ACTORS)
    vi.advanceTimersByTime(ACTOR_PUBLIC_STATUSES_COUNT_TTL_MS + 1)
    await getCachedActorPublicStatusesCount(database, actorId(3))

    const cached = getActorPublicStatusesCountCachedActorIdsForTests(database)
    expect(cached).toHaveLength(MAX_CACHED_ACTORS)
    expect(cached).toContain(actorId(0))
    expect(cached.at(-1)).toBe(actorId(3))
  })

  it('does not drop a concurrently cached actor on a cold database', async () => {
    const { database, getActorStatusesCount } = mockDatabase([111, 222])

    const [first, second] = await Promise.all([
      getCachedActorPublicStatusesCount(database, actorId(0)),
      getCachedActorPublicStatusesCount(database, actorId(1))
    ])

    expect([first, second]).toEqual([111, 222])
    expect(
      getActorPublicStatusesCountCachedActorIdsForTests(database)
    ).toHaveLength(2)

    getActorStatusesCount.mockClear()
    expect(await getCachedActorPublicStatusesCount(database, actorId(0))).toBe(
      111
    )
    expect(await getCachedActorPublicStatusesCount(database, actorId(1))).toBe(
      222
    )
    expect(getActorStatusesCount).not.toHaveBeenCalled()
  })

  it('runs one query for a burst of concurrent misses on one actor', async () => {
    const { database, getActorStatusesCount } = mockDatabase([1938, 2000])

    const counts = await Promise.all(
      Array.from({ length: 25 }, () =>
        getCachedActorPublicStatusesCount(database, ACTOR_ID)
      )
    )

    expect(counts).toEqual(Array(25).fill(1938))
    expect(getActorStatusesCount).toHaveBeenCalledTimes(1)
  })

  it('does not hold a failed query against the actors waiting on it', async () => {
    const { database, getActorStatusesCount } = mockDatabase(1938)
    getActorStatusesCount.mockRejectedValueOnce(new Error('database is down'))

    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () =>
        getCachedActorPublicStatusesCount(database, ACTOR_ID)
      )
    )

    // Every waiter sees the failure rather than hanging on a promise that is
    // never replaced, and none of them cached it.
    expect(results.map((result) => result.status)).toEqual([
      'rejected',
      'rejected',
      'rejected'
    ])
    expect(getActorStatusesCount).toHaveBeenCalledTimes(1)
    expect(
      getActorPublicStatusesCountCachedActorIdsForTests(database)
    ).toHaveLength(0)

    expect(await getCachedActorPublicStatusesCount(database, ACTOR_ID)).toBe(
      1938
    )
    expect(getActorStatusesCount).toHaveBeenCalledTimes(2)
  })

  // A query can outlive its own TTL and reject after a later miss has already
  // cached a good count. Its cleanup must recognise it is no longer the cached
  // entry and leave the successor alone.
  it('does not let a late failure evict the entry that replaced it', async () => {
    let failSlowQuery = (_: Error) => {}
    const slowQuery = new Promise<number>((_, reject) => {
      failSlowQuery = reject
    })
    const getActorStatusesCount = vi
      .fn<() => Promise<number>>()
      .mockReturnValueOnce(slowQuery)
      .mockResolvedValue(555)
    const database = { getActorStatusesCount } as unknown as Database

    const failing = getCachedActorPublicStatusesCount(database, ACTOR_ID)
    const rejection = expect(failing).rejects.toThrow('database is down')

    // The slow query is still running when its entry expires, so the next
    // caller starts a fresh one and caches that instead.
    vi.advanceTimersByTime(ACTOR_PUBLIC_STATUSES_COUNT_TTL_MS + 1)
    expect(await getCachedActorPublicStatusesCount(database, ACTOR_ID)).toBe(
      555
    )

    failSlowQuery(new Error('database is down'))
    await rejection

    expect(getActorPublicStatusesCountCachedActorIdsForTests(database)).toEqual(
      [ACTOR_ID]
    )
    expect(await getCachedActorPublicStatusesCount(database, ACTOR_ID)).toBe(
      555
    )
    expect(getActorStatusesCount).toHaveBeenCalledTimes(2)
  })
})
