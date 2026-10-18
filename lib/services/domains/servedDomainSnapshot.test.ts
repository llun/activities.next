import { Database } from '@/lib/database/types'
import { headerHost } from '@/lib/services/guards/headerHost'
import { createDeferred } from '@/lib/testing/deferred'
import { selectHeaderHost } from '@/lib/utils/host'

import {
  SERVED_DOMAIN_MAX_STALE_MS,
  SERVED_DOMAIN_REFRESH_MS,
  ensureServedDomainsFresh,
  getActiveServedDomainNames,
  getServedHostConfig,
  refreshServedDomains,
  refreshServedDomainsAfterWrite,
  resetServedDomainsForTests,
  setServedDomainsForTests
} from './servedDomainSnapshot'

const config = { host: 'social.example', trustedHosts: ['club.example'] }

const databaseWith = (domains: string[]) => {
  const getActiveServedDomains = vi.fn(async () =>
    domains.map((domain) => ({ domain }))
  )
  return {
    database: { getActiveServedDomains } as unknown as Database,
    getActiveServedDomains
  }
}

describe('servedDomainSnapshot', () => {
  beforeEach(() => {
    resetServedDomainsForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
    resetServedDomainsForTests()
  })

  it('has no database domains before the first load', () => {
    expect(getActiveServedDomainNames()).toEqual([])
    expect(getServedHostConfig(config).servedDomains).toEqual([])
  })

  it('loads the active rows, normalised, and drops anything that is not a plain domain', async () => {
    const { database } = databaseWith([
      'Run.Example.',
      'birds.example:443',
      '*.wild.example',
      'bad/path.example'
    ])
    await refreshServedDomains(database)
    expect(getActiveServedDomainNames()).toEqual([
      'run.example',
      'birds.example'
    ])
  })

  it('makes an active domain a trusted header host, and an unknown one fall back', async () => {
    const { database } = databaseWith(['run.example'])
    await refreshServedDomains(database)
    const served = getServedHostConfig(config)
    expect(selectHeaderHost(new Headers({ host: 'run.example' }), served)).toBe(
      'run.example'
    )
    expect(
      selectHeaderHost(new Headers({ host: 'evil.example' }), served)
    ).toBe('social.example')
  })

  it('stops trusting a domain once a refresh no longer lists it', async () => {
    const domains = ['run.example']
    const getActiveServedDomains = vi.fn(async () =>
      domains.map((domain) => ({ domain }))
    )
    const database = { getActiveServedDomains } as unknown as Database
    await refreshServedDomains(database)
    expect(getActiveServedDomainNames()).toEqual(['run.example'])

    domains.length = 0
    await refreshServedDomains(database)
    expect(getActiveServedDomainNames()).toEqual([])
    expect(
      selectHeaderHost(
        new Headers({ host: 'run.example' }),
        getServedHostConfig(config)
      )
    ).toBe('social.example')
  })

  it('fails closed: a snapshot past the maximum staleness trusts no database domain', () => {
    vi.useFakeTimers()
    setServedDomainsForTests(['run.example'])
    expect(getActiveServedDomainNames()).toEqual(['run.example'])
    vi.advanceTimersByTime(SERVED_DOMAIN_MAX_STALE_MS + 1)
    expect(getActiveServedDomainNames()).toEqual([])
  })

  it('keeps the last good snapshot when a reload fails', async () => {
    const getActiveServedDomains = vi
      .fn()
      .mockResolvedValueOnce([{ domain: 'run.example' }])
      .mockRejectedValueOnce(new Error('database down'))
    const database = { getActiveServedDomains } as unknown as Database
    await refreshServedDomains(database)
    await refreshServedDomains(database)
    expect(getActiveServedDomainNames()).toEqual(['run.example'])
  })

  it('ensureServedDomainsFresh queries only when the snapshot is stale', async () => {
    vi.useFakeTimers()
    const { database, getActiveServedDomains } = databaseWith(['run.example'])
    await refreshServedDomains(database)
    expect(getActiveServedDomains).toHaveBeenCalledTimes(1)

    await ensureServedDomainsFresh()
    expect(getActiveServedDomains).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(SERVED_DOMAIN_REFRESH_MS + 1)
    await ensureServedDomainsFresh()
    expect(getActiveServedDomains).toHaveBeenCalledTimes(2)
  })

  // A database outage must not hold every request on a fresh failing query.
  it('ensureServedDomainsFresh waits out the refresh interval after a failed load', async () => {
    vi.useFakeTimers()
    const getActiveServedDomains = vi
      .fn()
      .mockRejectedValueOnce(new Error('database down'))
      .mockResolvedValue([{ domain: 'run.example' }])
    const database = { getActiveServedDomains } as unknown as Database
    await refreshServedDomains(database)
    expect(getActiveServedDomains).toHaveBeenCalledTimes(1)

    await ensureServedDomainsFresh()
    vi.advanceTimersByTime(SERVED_DOMAIN_REFRESH_MS - 1)
    await ensureServedDomainsFresh()
    expect(getActiveServedDomains).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(2)
    await ensureServedDomainsFresh()
    expect(getActiveServedDomains).toHaveBeenCalledTimes(2)
    expect(getActiveServedDomainNames()).toEqual(['run.example'])
  })

  // The sync read must honour the same back-off, or an outage costs a failing
  // query (and an error log) per request.
  it('getActiveServedDomainNames waits out the refresh interval after a failed load', async () => {
    vi.useFakeTimers()
    const getActiveServedDomains = vi
      .fn()
      .mockRejectedValue(new Error('database down'))
    const database = { getActiveServedDomains } as unknown as Database
    await refreshServedDomains(database)
    expect(getActiveServedDomains).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(SERVED_DOMAIN_REFRESH_MS - 1)
    getActiveServedDomainNames()
    await vi.advanceTimersByTimeAsync(0)
    expect(getActiveServedDomains).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(2)
    getActiveServedDomainNames()
    getActiveServedDomainNames()
    await vi.advanceTimersByTimeAsync(0)
    expect(getActiveServedDomains).toHaveBeenCalledTimes(2)
  })

  it('shares one load between concurrent refreshes', async () => {
    const { database, getActiveServedDomains } = databaseWith(['run.example'])
    await Promise.all([
      refreshServedDomains(database),
      refreshServedDomains(database)
    ])
    expect(getActiveServedDomains).toHaveBeenCalledTimes(1)
  })

  // A load that started before an admin write may have read the table before
  // the write committed; the write's own refresh must not just join it.
  it('loads again after an admin write instead of joining a load already in flight', async () => {
    const beforeWrite = createDeferred<{ domain: string }[]>()
    const getActiveServedDomains = vi
      .fn()
      .mockReturnValueOnce(beforeWrite.promise)
      .mockResolvedValueOnce([])
    const database = { getActiveServedDomains } as unknown as Database

    const inflight = refreshServedDomains(database)
    const afterWrite = refreshServedDomainsAfterWrite(database)
    beforeWrite.resolve([{ domain: 'run.example' }])
    await Promise.all([inflight, afterWrite])

    expect(getActiveServedDomains).toHaveBeenCalledTimes(2)
    expect(getActiveServedDomainNames()).toEqual([])
  })

  it('starts one background refresh when a sync read finds the snapshot stale', async () => {
    vi.useFakeTimers()
    const { database, getActiveServedDomains } = databaseWith(['run.example'])
    await refreshServedDomains(database)
    expect(getActiveServedDomains).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(SERVED_DOMAIN_REFRESH_MS)
    getActiveServedDomainNames()
    expect(getActiveServedDomains).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    getActiveServedDomainNames()
    getActiveServedDomainNames()
    expect(getActiveServedDomains).toHaveBeenCalledTimes(2)
  })

  it('returns the same config object until the domain list changes', () => {
    setServedDomainsForTests(['run.example'])
    const first = getServedHostConfig(config)
    expect(getServedHostConfig(config)).toBe(first)
    setServedDomainsForTests(['run.example', 'birds.example'])
    expect(getServedHostConfig(config)).not.toBe(first)
  })

  it('feeds headerHost', () => {
    setServedDomainsForTests(['run.example'])
    // The global config mock's host is test.llun.dev.
    expect(headerHost(new Headers({ host: 'run.example' }))).toBe('run.example')
    expect(headerHost(new Headers({ host: 'other.example' }))).toBe(
      'test.llun.dev'
    )
  })

  // Next loads this module once per bundle (instrumentation, route handlers,
  // server components); the snapshot `register()` loads must reach them all.
  it('shares one snapshot between copies of the module', async () => {
    const { database } = databaseWith(['run.example'])
    vi.resetModules()
    const first = await import('./servedDomainSnapshot')
    vi.resetModules()
    const second = await import('./servedDomainSnapshot')
    expect(second).not.toBe(first)

    first.startServedDomainRefresher(database)
    await first.refreshServedDomains()
    expect(second.getActiveServedDomainNames()).toEqual(['run.example'])
    first.resetServedDomainsForTests()
  })
})
