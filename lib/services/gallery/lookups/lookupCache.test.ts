import { LOOKUP_CACHE_TTL_MS, readThroughLookupCache } from './lookupCache'
import { LookupError } from './lookupRequest'
import { createFakeLookupDatabase as createFakeDatabase } from './lookupTestUtils'

describe('readThroughLookupCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetches once, stores the value, and serves it from the cache', async () => {
    const { database, spies } = createFakeDatabase()
    const fetcher = vi.fn(async () => ({ name: 'Alcedo atthis' }))
    const params = { database, kind: 'gbif-match', key: 'k', fetcher } as const

    await expect(readThroughLookupCache(params)).resolves.toEqual({
      status: 'ok',
      value: { name: 'Alcedo atthis' }
    })
    await expect(readThroughLookupCache(params)).resolves.toEqual({
      status: 'ok',
      value: { name: 'Alcedo atthis' }
    })

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(spies.putGalleryLookup).toHaveBeenCalledWith({
      kind: 'gbif-match',
      key: 'k',
      outcome: 'ok',
      value: { name: 'Alcedo atthis' },
      ttlMs: LOOKUP_CACHE_TTL_MS['gbif-match'].ok
    })
  })

  it.each([
    ['gbif-match', 7 * 24 * 60 * 60 * 1000],
    ['gbif-search', 24 * 60 * 60 * 1000],
    ['geocode', 30 * 24 * 60 * 60 * 1000]
  ] as const)(
    'caches a miss for %s and does not ask again',
    async (kind, missTtl) => {
      const { database, spies } = createFakeDatabase()
      const fetcher = vi.fn(async () => null)

      await expect(
        readThroughLookupCache({ database, kind, key: 'k', fetcher })
      ).resolves.toEqual({ status: 'miss' })
      await expect(
        readThroughLookupCache({ database, kind, key: 'k', fetcher })
      ).resolves.toEqual({ status: 'miss' })

      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(spies.putGalleryLookup).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'miss',
          value: null,
          ttlMs: missTtl
        })
      )
    }
  )

  it('remembers an error for ten minutes, then asks again', async () => {
    const { database, spies } = createFakeDatabase()
    const failure = new Error('down')
    const fetcher = vi
      .fn<() => Promise<string | null>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce('back')
    const params = { database, kind: 'geocode', key: 'k', fetcher } as const

    await expect(readThroughLookupCache(params)).resolves.toEqual({
      status: 'error',
      error: failure
    })
    expect(spies.putGalleryLookup).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'error', ttlMs: 10 * 60 * 1000 })
    )

    vi.advanceTimersByTime(9 * 60 * 1000)
    await expect(readThroughLookupCache(params)).resolves.toEqual({
      status: 'error'
    })
    expect(fetcher).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(2 * 60 * 1000)
    await expect(readThroughLookupCache(params)).resolves.toEqual({
      status: 'ok',
      value: 'back'
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('asks again on a retry instead of answering a remembered error', async () => {
    const { database } = createFakeDatabase()
    const fetcher = vi
      .fn<() => Promise<string | null>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce('back')
    const params = { database, kind: 'geocode', key: 'k', fetcher } as const

    await readThroughLookupCache(params)
    await expect(
      readThroughLookupCache({ ...params, skipCachedError: true })
    ).resolves.toEqual({ status: 'ok', value: 'back' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  // Decided in this process: the provider was never asked, so the failure
  // says nothing about the key. Cached, it would outlive the circuit and
  // answer another process (the backfill) whose provider is fine.
  it.each(['circuit-open', 'rate-limited'] as const)(
    'does not remember a %s failure',
    async (code) => {
      const { database, rows, spies } = createFakeDatabase()
      const fetcher = vi
        .fn<() => Promise<string | null>>()
        .mockRejectedValueOnce(new LookupError(code, 'local'))
        .mockResolvedValueOnce('fine')
      const params = { database, kind: 'geocode', key: 'k', fetcher } as const

      await expect(readThroughLookupCache(params)).resolves.toMatchObject({
        status: 'error'
      })
      expect(spies.putGalleryLookup).not.toHaveBeenCalled()
      expect(rows.size).toBe(0)

      // The next call asks the provider, without a retry.
      await expect(readThroughLookupCache(params)).resolves.toEqual({
        status: 'ok',
        value: 'fine'
      })
    }
  )

  it.each(['network', 'unavailable', 'http', 'parse'] as const)(
    'remembers a %s failure from the provider',
    async (code) => {
      const { database, rows } = createFakeDatabase()
      const fetcher = vi.fn(async () => {
        throw new LookupError(code, 'remote')
      })

      await readThroughLookupCache({
        database,
        kind: 'geocode',
        key: 'k',
        fetcher
      })

      expect(rows.get('geocode:k')?.outcome).toBe('error')
    }
  )

  it('still serves hits and misses from the cache on a retry', async () => {
    const { database } = createFakeDatabase()
    const fetcher = vi.fn(async () => null)
    const params = {
      database,
      kind: 'gbif-match',
      key: 'k',
      fetcher,
      skipCachedError: true
    } as const

    await readThroughLookupCache(params)
    await expect(readThroughLookupCache(params)).resolves.toEqual({
      status: 'miss'
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('refetches an expired row', async () => {
    const { database } = createFakeDatabase()
    const fetcher = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce('old')
      .mockResolvedValueOnce('new')
    const params = { database, kind: 'gbif-search', key: 'k', fetcher } as const

    await readThroughLookupCache(params)
    vi.advanceTimersByTime(LOOKUP_CACHE_TTL_MS['gbif-search'].ok + 1)

    await expect(readThroughLookupCache(params)).resolves.toEqual({
      status: 'ok',
      value: 'new'
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('shares one fetch between concurrent callers for the same key', async () => {
    const { database } = createFakeDatabase()
    let resolveFetch: (value: string) => void = () => {}
    const fetcher = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFetch = resolve
        })
    )
    const params = { database, kind: 'geocode', key: 'k', fetcher } as const

    const first = readThroughLookupCache(params)
    const second = readThroughLookupCache(params)
    await vi.advanceTimersByTimeAsync(0)
    resolveFetch('Khao Yai')

    await expect(first).resolves.toEqual({ status: 'ok', value: 'Khao Yai' })
    await expect(second).resolves.toEqual({ status: 'ok', value: 'Khao Yai' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not share a fetch between different keys', async () => {
    const { database } = createFakeDatabase()
    const fetcher = vi.fn(async () => 'v')

    await Promise.all([
      readThroughLookupCache({ database, kind: 'geocode', key: 'a', fetcher }),
      readThroughLookupCache({ database, kind: 'geocode', key: 'b', fetcher })
    ])

    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('still answers when the cache cannot be read or written', async () => {
    const { database, spies } = createFakeDatabase()
    spies.getGalleryLookup.mockRejectedValueOnce(new Error('db read'))
    spies.putGalleryLookup.mockRejectedValueOnce(new Error('db write'))

    await expect(
      readThroughLookupCache({
        database,
        kind: 'geocode',
        key: 'k',
        fetcher: async () => 'v'
      })
    ).resolves.toEqual({ status: 'ok', value: 'v' })
  })

  it('refetches when an ok row has no value', async () => {
    const { database, rows } = createFakeDatabase()
    rows.set('geocode:k', {
      kind: 'geocode',
      key: 'k',
      outcome: 'ok',
      value: null,
      fetchedAt: Date.now(),
      expiresAt: Date.now() + 1000
    })

    await expect(
      readThroughLookupCache({
        database,
        kind: 'geocode',
        key: 'k',
        fetcher: async () => 'fresh'
      })
    ).resolves.toEqual({ status: 'ok', value: 'fresh' })
  })
})
