import { Database } from '@/lib/database/types'
import {
  BELOW_THRESHOLD_CACHE_TTL_MS,
  clearLocalPublicStatusesCountCache,
  getCachedLocalPublicStatusesCount
} from '@/lib/services/timelines/localPublicCount'

// Only getLocalPublicStatusesCount is exercised; the cache never touches the
// rest of the Database surface.
const mockDatabase = (count: number | number[]) => {
  const counts = Array.isArray(count) ? [...count] : null
  const getLocalPublicStatusesCount = vi.fn(async () =>
    counts ? (counts.shift() ?? 0) : (count as number)
  )
  return {
    database: { getLocalPublicStatusesCount } as unknown as Database,
    getLocalPublicStatusesCount
  }
}

describe('getCachedLocalPublicStatusesCount', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('queries the database on the first call and passes the limit through', async () => {
    const { database, getLocalPublicStatusesCount } = mockDatabase(100)

    expect(await getCachedLocalPublicStatusesCount(database, 100)).toBe(100)
    expect(getLocalPublicStatusesCount).toHaveBeenCalledExactlyOnceWith(100)
  })

  it('serves a repeat call from the cache without querying again', async () => {
    const { database, getLocalPublicStatusesCount } = mockDatabase(100)

    await getCachedLocalPublicStatusesCount(database, 100)
    expect(await getCachedLocalPublicStatusesCount(database, 100)).toBe(100)
    expect(getLocalPublicStatusesCount).toHaveBeenCalledTimes(1)
  })

  it('never expires a result that reached the threshold', async () => {
    const { database, getLocalPublicStatusesCount } = mockDatabase(100)

    await getCachedLocalPublicStatusesCount(database, 100)
    vi.advanceTimersByTime(BELOW_THRESHOLD_CACHE_TTL_MS * 1000)

    expect(await getCachedLocalPublicStatusesCount(database, 100)).toBe(100)
    expect(getLocalPublicStatusesCount).toHaveBeenCalledTimes(1)
  })

  it('re-queries a below-threshold result once its TTL elapses', async () => {
    const { database, getLocalPublicStatusesCount } = mockDatabase([7, 100])

    expect(await getCachedLocalPublicStatusesCount(database, 100)).toBe(7)
    vi.advanceTimersByTime(BELOW_THRESHOLD_CACHE_TTL_MS + 1)

    expect(await getCachedLocalPublicStatusesCount(database, 100)).toBe(100)
    expect(getLocalPublicStatusesCount).toHaveBeenCalledTimes(2)
  })

  it('keeps serving a below-threshold result until its TTL elapses', async () => {
    const { database, getLocalPublicStatusesCount } = mockDatabase([7, 100])

    await getCachedLocalPublicStatusesCount(database, 100)
    vi.advanceTimersByTime(BELOW_THRESHOLD_CACHE_TTL_MS - 1)

    expect(await getCachedLocalPublicStatusesCount(database, 100)).toBe(7)
    expect(getLocalPublicStatusesCount).toHaveBeenCalledTimes(1)
  })

  it('re-queries when the limit differs from the cached one', async () => {
    const { database, getLocalPublicStatusesCount } = mockDatabase([100, 50])

    await getCachedLocalPublicStatusesCount(database, 100)
    expect(await getCachedLocalPublicStatusesCount(database, 50)).toBe(50)
    expect(getLocalPublicStatusesCount).toHaveBeenNthCalledWith(2, 50)
  })

  it('caches per database instance', async () => {
    const first = mockDatabase(100)
    const second = mockDatabase(100)

    await getCachedLocalPublicStatusesCount(first.database, 100)
    await getCachedLocalPublicStatusesCount(second.database, 100)

    expect(first.getLocalPublicStatusesCount).toHaveBeenCalledTimes(1)
    expect(second.getLocalPublicStatusesCount).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failure, so the next call retries', async () => {
    const { database, getLocalPublicStatusesCount } = mockDatabase(100)
    getLocalPublicStatusesCount.mockRejectedValueOnce(
      new Error('database is down')
    )

    await expect(
      getCachedLocalPublicStatusesCount(database, 100)
    ).rejects.toThrow('database is down')
    expect(await getCachedLocalPublicStatusesCount(database, 100)).toBe(100)
    expect(getLocalPublicStatusesCount).toHaveBeenCalledTimes(2)
  })

  it('re-queries after the cached entry is cleared', async () => {
    const { database, getLocalPublicStatusesCount } = mockDatabase(100)

    await getCachedLocalPublicStatusesCount(database, 100)
    clearLocalPublicStatusesCountCache(database)
    await getCachedLocalPublicStatusesCount(database, 100)

    expect(getLocalPublicStatusesCount).toHaveBeenCalledTimes(2)
  })
})
