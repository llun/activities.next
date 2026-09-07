import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  cancelFitnessRouteHeatmap,
  clearFitnessRouteHeatmaps,
  deleteFitnessRouteHeatmap,
  getFitnessRouteHeatmap,
  getFitnessRouteHeatmapRegionNames,
  getFitnessRouteHeatmapTiles,
  getFitnessRouteHeatmaps,
  getPublicHeatmapTiles,
  setFitnessRouteHeatmapRegionName,
  shareFitnessRouteHeatmap,
  triggerFitnessRouteHeatmap,
  unshareFitnessRouteHeatmap
} from './fitnessHeatmaps'

enableFetchMocks()

describe('fitness route heatmap client calls', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        origin: 'http://llun.test'
      }
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window')
  })

  const lastUrl = () =>
    new URL(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0] as string)

  const TILE_BATCH = {
    z: 8,
    tiles: [
      { x: 132, y: 85 },
      { x: 133, y: 85 }
    ],
    version: 4
  }

  it('asks the owner route for a tile batch at one zoom', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ version: 4, tiles: { '132:85': '{}', '133:85': null } }),
      { status: 200 }
    )

    await expect(
      getFitnessRouteHeatmapTiles({
        actorId: 'https://llun.test/users/test1',
        region: 'rect:52.00,5.00,51.00,6.00',
        ...TILE_BATCH
      })
    ).resolves.toEqual({
      version: 4,
      tiles: { '132:85': '{}', '133:85': null }
    })

    const url = lastUrl()
    expect(url.pathname).toBe(
      '/api/v1/accounts/llun.test:users:test1/fitness-route-heatmap/tiles'
    )
    expect(url.searchParams.get('z')).toBe('8')
    expect(url.searchParams.get('tiles')).toBe('132:85,133:85')
    expect(url.searchParams.get('v')).toBe('4')
    expect(url.searchParams.get('region')).toBe('rect:52.00,5.00,51.00,6.00')
  })

  it('omits the region from an owner tile request that has none', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ version: 4, tiles: {} }), {
      status: 200
    })

    await getFitnessRouteHeatmapTiles({
      actorId: 'https://llun.test/users/test1',
      ...TILE_BATCH
    })
    expect(lastUrl().searchParams.has('region')).toBe(false)
  })

  it('supports passing an AbortSignal to owner tile requests', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ version: 4, tiles: {} }), {
      status: 200
    })
    const controller = new AbortController()

    await getFitnessRouteHeatmapTiles({
      actorId: 'https://llun.test/users/test1',
      signal: controller.signal,
      ...TILE_BATCH
    })

    const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
    expect((lastCall[1] as RequestInit).signal).toBe(controller.signal)
  })

  it('asks the public route by token, sending no region at all', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ version: 4, tiles: { '132:85': '{}' } }),
      { status: 200 }
    )

    await getPublicHeatmapTiles({ token: 'tok 123', ...TILE_BATCH })

    const url = lastUrl()
    expect(url.pathname).toBe('/embed/heatmap/tok%20123/tiles')
    expect(url.searchParams.get('z')).toBe('8')
    expect(url.searchParams.get('tiles')).toBe('132:85,133:85')
    expect(url.searchParams.get('v')).toBe('4')
    // The server clips to the shared row's own scope; a region from the caller
    // would be exactly the wrong thing to honour.
    expect(url.searchParams.has('region')).toBe(false)
  })

  it('supports passing an AbortSignal to public tile requests', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ version: 4, tiles: {} }), {
      status: 200
    })
    const controller = new AbortController()

    await getPublicHeatmapTiles({
      token: 'tok123',
      signal: controller.signal,
      ...TILE_BATCH
    })

    const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
    expect((lastCall[1] as RequestInit).signal).toBe(controller.signal)
  })

  it('reads a public 404 as the empty batch its own type documents', async () => {
    // The public route REFUSES rather than describing — a share the pyramid
    // cannot answer is a 404 — so the fetcher translates it into the version 0
    // the owner route returns for the same situation, and a caller gets one
    // "no tiles, draw the untiled geometry" branch instead of two.
    fetchMock.mockResponseOnce('', { status: 404 })

    await expect(
      getPublicHeatmapTiles({ token: 'tok123', ...TILE_BATCH })
    ).resolves.toEqual({
      version: 0,
      tiles: { '132:85': null, '133:85': null }
    })
  })

  it.each([
    { description: 'a server error', status: 500 },
    { description: 'a bad request', status: 400 }
  ])(
    'still throws on $description from the public route',
    async ({ status }) => {
      fetchMock.mockResponseOnce(JSON.stringify({ message: 'nope' }), {
        status
      })

      await expect(
        getPublicHeatmapTiles({ token: 'tok123', ...TILE_BATCH })
      ).rejects.toThrow(`Failed to load route heatmap tiles (${status}): nope`)
    }
  )

  it('throws when an owner tile request fails', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ message: 'owner only' }), {
      status: 403
    })

    await expect(
      getFitnessRouteHeatmapTiles({
        actorId: 'https://llun.test/users/test1',
        ...TILE_BATCH
      })
    ).rejects.toThrow('Failed to load route heatmap tiles (403): owner only')
  })

  it('loads focused route heatmap cache with all parameters', async () => {
    const mockHeatmap = {
      id: 'hm-1',
      periodType: 'monthly',
      periodKey: '2026-04',
      activityType: 'running',
      region: 'netherlands',
      status: 'ready',
      segments: [],
      activityCount: 5,
      pointCount: 100,
      totalCount: 5,
      cursorOffset: 5,
      isPartial: false,
      createdAt: 1000,
      updatedAt: 2000
    }
    fetchMock.mockResponseOnce(JSON.stringify({ heatmap: mockHeatmap }), {
      status: 200
    })

    const result = await getFitnessRouteHeatmap({
      actorId: 'https://llun.test/users/test1',
      periodType: 'monthly',
      periodKey: '2026-04',
      activityType: 'running',
      region: 'netherlands'
    })

    expect(result).toEqual(mockHeatmap)
    const url = lastUrl()
    expect(url.pathname).toBe(
      '/api/v1/accounts/llun.test:users:test1/fitness-route-heatmap'
    )
    expect(url.searchParams.get('period_type')).toBe('monthly')
    expect(url.searchParams.get('period_key')).toBe('2026-04')
    expect(url.searchParams.get('activity_type')).toBe('running')
    expect(url.searchParams.get('region')).toBe('netherlands')
  })

  it('returns null if response json parsing fails', async () => {
    fetchMock.mockResponseOnce('not-json', { status: 200 })

    const result = await getFitnessRouteHeatmap({
      actorId: 'https://llun.test/users/test1',
      periodType: 'monthly',
      periodKey: '2026-04'
    })

    expect(result).toBeNull()
  })

  it('preserves JSON error details when the focused route heatmap request fails', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ message: 'owner only' }), {
      status: 403
    })

    await expect(
      getFitnessRouteHeatmap({
        actorId: 'https://llun.test/users/test1',
        periodType: 'monthly',
        periodKey: '2026-04'
      })
    ).rejects.toThrow('Failed to load route heatmap (403): owner only')
  })

  it('loads route heatmap history list', async () => {
    const mockList = [
      {
        id: 'hm-1',
        periodType: 'monthly',
        periodKey: '2026-04',
        status: 'ready',
        activityCount: 5,
        pointCount: 100,
        totalCount: 5,
        cursorOffset: 5,
        isPartial: false,
        createdAt: 1000,
        updatedAt: 2000
      }
    ]
    fetchMock.mockResponseOnce(JSON.stringify({ heatmaps: mockList }), {
      status: 200
    })

    const result = await getFitnessRouteHeatmaps({
      actorId: 'https://llun.test/users/test1'
    })

    expect(result).toEqual(mockList)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://llun.test/api/v1/accounts/llun.test:users:test1/fitness-route-heatmaps',
      expect.objectContaining({
        method: 'GET',
        headers: { Accept: 'application/json' }
      })
    )
  })

  it('preserves raw text error details when the route heatmap history request fails', async () => {
    fetchMock.mockResponseOnce('upstream unavailable', {
      status: 503,
      statusText: 'Service Unavailable'
    })

    await expect(
      getFitnessRouteHeatmaps({
        actorId: 'https://llun.test/users/test1'
      })
    ).rejects.toThrow(
      'Failed to load route heatmaps (503): upstream unavailable'
    )
  })

  it('clears all route heatmaps for an actor', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ deleted: 3 }), { status: 200 })

    await expect(
      clearFitnessRouteHeatmaps({
        actorId: 'https://llun.test/users/test1'
      })
    ).resolves.toBe(3)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://llun.test/api/v1/accounts/llun.test:users:test1/fitness-route-heatmaps',
      expect.objectContaining({
        method: 'DELETE',
        headers: { Accept: 'application/json' }
      })
    )
  })

  it('throws a detailed error when clearing route heatmaps fails', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ message: 'failed' }), {
      status: 500
    })

    await expect(
      clearFitnessRouteHeatmaps({
        actorId: 'https://llun.test/users/test1'
      })
    ).rejects.toThrow('Failed to load route heatmaps (500): failed')
  })

  it('removes a single route heatmap by key', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ deleted: true }), {
      status: 200
    })

    await expect(
      deleteFitnessRouteHeatmap({
        actorId: 'https://llun.test/users/test1',
        activityType: 'running',
        periodType: 'monthly',
        periodKey: '2026-04',
        region: 'netherlands'
      })
    ).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://llun.test/api/v1/accounts/llun.test:users:test1/fitness-route-heatmap?period_type=monthly&period_key=2026-04&activity_type=running&region=netherlands',
      expect.objectContaining({
        method: 'DELETE',
        headers: { Accept: 'application/json' }
      })
    )
  })

  it('throws a detailed error when removing a route heatmap fails', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ error: 'owner only' }), {
      status: 403
    })

    await expect(
      deleteFitnessRouteHeatmap({
        actorId: 'https://llun.test/users/test1',
        periodType: 'all_time',
        periodKey: 'all'
      })
    ).rejects.toThrow('Failed to load route heatmap (403): owner only')
  })

  it('sends a cancel flag when cancelling a route heatmap job', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ cancelled: true }), {
      status: 200
    })

    await expect(
      cancelFitnessRouteHeatmap({
        actorId: 'https://llun.test/users/test1',
        activityType: 'running',
        periodType: 'monthly',
        periodKey: '2026-04',
        region: 'netherlands'
      })
    ).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://llun.test/api/v1/accounts/llun.test:users:test1/fitness-route-heatmap',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          period_type: 'monthly',
          period_key: '2026-04',
          activity_type: 'running',
          region: 'netherlands',
          cancel: true
        })
      })
    )
  })

  it('throws an error when cancelling a route heatmap fails', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ error: 'forbidden' }), {
      status: 403
    })

    await expect(
      cancelFitnessRouteHeatmap({
        actorId: 'https://llun.test/users/test1',
        periodType: 'monthly',
        periodKey: '2026-04'
      })
    ).rejects.toThrow('Failed to load route heatmap (403): forbidden')
  })

  it('triggers a route heatmap job without retry flag by default', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ queued: true }), {
      status: 202
    })

    await expect(
      triggerFitnessRouteHeatmap({
        actorId: 'https://llun.test/users/test1',
        activityType: 'running',
        periodType: 'monthly',
        periodKey: '2026-04'
      })
    ).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://llun.test/api/v1/accounts/llun.test:users:test1/fitness-route-heatmap',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          period_type: 'monthly',
          period_key: '2026-04',
          activity_type: 'running'
        })
      })
    )
  })

  it('sends an explicit retry flag when triggering a retry route heatmap job', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ queued: true }), {
      status: 202
    })

    await expect(
      triggerFitnessRouteHeatmap({
        actorId: 'https://llun.test/users/test1',
        activityType: 'running',
        periodType: 'monthly',
        periodKey: '2026-04',
        region: 'netherlands',
        retry: true
      })
    ).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://llun.test/api/v1/accounts/llun.test:users:test1/fitness-route-heatmap',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          period_type: 'monthly',
          period_key: '2026-04',
          activity_type: 'running',
          region: 'netherlands',
          retry: true
        })
      })
    )
  })

  it('enables public sharing for a route heatmap and returns the share token', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ shareToken: 'tok-abc' }), {
      status: 200
    })

    const token = await shareFitnessRouteHeatmap({
      actorId: 'https://llun.test/users/test1',
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2026-04',
      region: 'netherlands'
    })

    expect(token).toBe('tok-abc')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://llun.test/api/v1/accounts/llun.test:users:test1/fitness-route-heatmap/share',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period_type: 'monthly',
          period_key: '2026-04',
          activity_type: 'running',
          region: 'netherlands'
        })
      })
    )
  })

  it('throws an error when sharing fails', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ error: 'share failed' }), {
      status: 500
    })

    await expect(
      shareFitnessRouteHeatmap({
        actorId: 'https://llun.test/users/test1',
        periodType: 'monthly',
        periodKey: '2026-04'
      })
    ).rejects.toThrow('Failed to load heatmap share (500): share failed')
  })

  it('disables public sharing for a route heatmap', async () => {
    fetchMock.mockResponseOnce('', { status: 200 })

    await unshareFitnessRouteHeatmap({
      actorId: 'https://llun.test/users/test1',
      activityType: 'cycling',
      periodType: 'yearly',
      periodKey: '2025',
      region: 'netherlands'
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://llun.test/api/v1/accounts/llun.test:users:test1/fitness-route-heatmap/share?period_type=yearly&period_key=2025&activity_type=cycling&region=netherlands',
      expect.objectContaining({
        method: 'DELETE',
        headers: { Accept: 'application/json' }
      })
    )
  })

  it('throws an error when unsharing fails', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ error: 'unshare failed' }), {
      status: 500
    })

    await expect(
      unshareFitnessRouteHeatmap({
        actorId: 'https://llun.test/users/test1',
        periodType: 'monthly',
        periodKey: '2026-04'
      })
    ).rejects.toThrow('Failed to load heatmap share (500): unshare failed')
  })

  it('loads saved region names for an actor', async () => {
    const mockNames = [{ region: 'rect:52.00,5.00,51.00,6.00', name: 'Home' }]
    fetchMock.mockResponseOnce(JSON.stringify({ names: mockNames }), {
      status: 200
    })

    const result = await getFitnessRouteHeatmapRegionNames({
      actorId: 'https://llun.test/users/test1'
    })

    expect(result).toEqual(mockNames)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://llun.test/api/v1/accounts/llun.test:users:test1/fitness-route-heatmap-region-names',
      expect.objectContaining({
        method: 'GET',
        headers: { Accept: 'application/json' }
      })
    )
  })

  it('returns empty array when region names request fails or returns invalid json', async () => {
    fetchMock.mockResponseOnce('', { status: 500 })
    expect(
      await getFitnessRouteHeatmapRegionNames({
        actorId: 'https://llun.test/users/test1'
      })
    ).toEqual([])

    fetchMock.mockResponseOnce('invalid-json', { status: 200 })
    expect(
      await getFitnessRouteHeatmapRegionNames({
        actorId: 'https://llun.test/users/test1'
      })
    ).toEqual([])
  })

  it('saves a region name label', async () => {
    fetchMock.mockResponseOnce('', { status: 200 })

    const success = await setFitnessRouteHeatmapRegionName({
      actorId: 'https://llun.test/users/test1',
      region: 'rect:52.00,5.00,51.00,6.00',
      name: 'Amsterdam'
    })

    expect(success).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://llun.test/api/v1/accounts/llun.test:users:test1/fitness-route-heatmap-region-names',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          region: 'rect:52.00,5.00,51.00,6.00',
          name: 'Amsterdam'
        })
      })
    )
  })

  it('clears a region name label by setting null', async () => {
    fetchMock.mockResponseOnce('', { status: 200 })

    const success = await setFitnessRouteHeatmapRegionName({
      actorId: 'https://llun.test/users/test1',
      region: 'rect:52.00,5.00,51.00,6.00',
      name: null
    })

    expect(success).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://llun.test/api/v1/accounts/llun.test:users:test1/fitness-route-heatmap-region-names',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          region: 'rect:52.00,5.00,51.00,6.00',
          name: null
        })
      })
    )
  })
})
