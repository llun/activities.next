/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'

import type { FitnessRouteHeatmapTileBatch } from '@/lib/client'
import {
  MAX_TILES_PER_REQUEST,
  TILE_EXTENT
} from '@/lib/services/fitness-files/heatmapTiles/constants'
import { encodeTile } from '@/lib/services/fitness-files/heatmapTiles/tileCodec'

import {
  MAX_TILES_PER_VIEW,
  TILE_CACHE_MAX_TILES,
  VIEW_SETTLE_MS,
  storedZoomForView,
  useHeatmapTiles
} from './useHeatmapTiles'

describe('storedZoomForView', () => {
  it.each([
    { description: 'below the ladder', view: 1.2, expected: 4 },
    { description: 'exactly the first rung', view: 4, expected: 4 },
    // Rounding UP, not to nearest: a rung is simplified to one pixel at its own
    // zoom, so drawing z4 tiles at view 4.1 would show the simplification.
    { description: 'a hair past a rung', view: 4.01, expected: 6 },
    { description: 'between rungs', view: 9.4, expected: 10 },
    { description: 'exactly a middle rung', view: 12, expected: 12 },
    { description: 'just under the top rung', view: 15.2, expected: 16 },
    { description: 'at the top rung', view: 16, expected: 16 },
    // Nothing finer exists; z16 reused at z17 is under ~2px of error.
    { description: 'past the ladder', view: 18.5, expected: 16 }
  ])('answers $expected for a view $description', ({ view, expected }) => {
    expect(storedZoomForView(view)).toBe(expected)
  })
})

describe('useHeatmapTiles', () => {
  const tileSource = {
    version: 3,
    minZoom: 4,
    maxZoom: 16,
    ladder: [4, 6, 8, 10, 12, 14, 16],
    extent: TILE_EXTENT
  }

  // A small area near Amsterdam; at z12 this is a handful of tiles.
  const bounds = { minLat: 52.36, maxLat: 52.38, minLng: 4.89, maxLng: 4.92 }
  const payload = encodeTile([{ count: 4, points: [0, 0, 16, 16] }])

  const batchOf = (
    tiles: Array<{ x: number; y: number }>,
    version = 3
  ): FitnessRouteHeatmapTileBatch => ({
    version,
    tiles: Object.fromEntries(tiles.map(({ x, y }) => [`${x}:${y}`, payload]))
  })

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const settle = async () => {
    await act(async () => {
      vi.advanceTimersByTime(VIEW_SETTLE_MS)
    })
  }

  it.each([
    { description: 'no tile source', source: null, fetcher: true },
    { description: 'no fetcher', source: tileSource, fetcher: false },
    {
      description: 'a tile extent this build cannot decode',
      source: { ...tileSource, extent: TILE_EXTENT + 1 },
      fetcher: true
    }
  ])('is disabled with $description', async ({ source, fetcher }) => {
    const fetchTiles = vi.fn()
    const { result } = renderHook(() =>
      useHeatmapTiles({
        tileSource: source,
        fetchTiles: fetcher ? fetchTiles : undefined
      })
    )

    expect(result.current.enabled).toBe(false)
    act(() => result.current.onViewChange({ zoom: 12, bounds }))
    // Settle first: asserting before the window closes would pass even for a
    // hook that had merely deferred the request rather than refused it.
    await settle()
    expect(fetchTiles).not.toHaveBeenCalled()
  })

  it('fetches the viewport once the pan settles', async () => {
    const fetchTiles = vi.fn(async ({ tiles }) => batchOf(tiles))
    const { result } = renderHook(() =>
      useHeatmapTiles({ tileSource, fetchTiles })
    )

    act(() => result.current.onViewChange({ zoom: 12, bounds }))
    expect(fetchTiles).not.toHaveBeenCalled()

    // Still nothing a frame before the window closes: a map fires these
    // continuously through a pinch, and spending a request on each would be
    // hundreds of round trips for one gesture.
    await act(async () => {
      vi.advanceTimersByTime(VIEW_SETTLE_MS - 1)
    })
    expect(fetchTiles).not.toHaveBeenCalled()

    await settle()

    expect(fetchTiles).toHaveBeenCalledTimes(1)
    expect(fetchTiles.mock.calls[0][0].z).toBe(12)
    await waitFor(() => expect(result.current.runs.length).toBeGreaterThan(0))
    expect(result.current.zoom).toBe(12)
  })

  it('spends one request on a burst of movement, not one per frame', async () => {
    const fetchTiles = vi.fn(async ({ tiles }) => batchOf(tiles))
    const { result } = renderHook(() =>
      useHeatmapTiles({ tileSource, fetchTiles })
    )

    act(() => {
      result.current.onViewChange({ zoom: 12, bounds })
      result.current.onViewChange({ zoom: 12.5, bounds })
      result.current.onViewChange({ zoom: 13, bounds })
    })
    await settle()

    expect(fetchTiles).toHaveBeenCalledTimes(1)
    // The LAST viewport, not the first: 13 rounds up to the z14 rung.
    expect(fetchTiles.mock.calls[0][0].z).toBe(14)
  })

  it('asks again for nothing it already holds', async () => {
    const fetchTiles = vi.fn(async ({ tiles }) => batchOf(tiles))
    const { result } = renderHook(() =>
      useHeatmapTiles({ tileSource, fetchTiles })
    )

    act(() => result.current.onViewChange({ zoom: 12, bounds }))
    await settle()
    await waitFor(() => expect(fetchTiles).toHaveBeenCalledTimes(1))

    act(() => result.current.onViewChange({ zoom: 12, bounds }))
    await settle()

    // Every tile was cached, so there was nothing left to request.
    expect(fetchTiles).toHaveBeenCalledTimes(1)
    expect(result.current.runs.length).toBeGreaterThan(0)
  })

  it('splits a viewport wider than one request into batches', async () => {
    // A desktop map just past a ladder rung genuinely needs more than
    // MAX_TILES_PER_REQUEST tiles, so this is the normal path, not a guard.
    const fetchTiles = vi.fn(async ({ tiles }) => batchOf(tiles))
    const { result } = renderHook(() =>
      useHeatmapTiles({ tileSource, fetchTiles })
    )

    act(() =>
      result.current.onViewChange({
        zoom: 6.01,
        bounds: { minLat: 45, maxLat: 55, minLng: 0, maxLng: 20 }
      })
    )
    await settle()
    await waitFor(() => expect(fetchTiles.mock.calls.length).toBeGreaterThan(1))

    for (const [request] of fetchTiles.mock.calls) {
      expect(request.tiles.length).toBeLessThanOrEqual(MAX_TILES_PER_REQUEST)
    }
    const requested = fetchTiles.mock.calls.flatMap(
      ([request]) => request.tiles
    )
    expect(
      new Set(requested.map((t: { x: number; y: number }) => `${t.x}:${t.y}`))
        .size
    ).toBe(requested.length)
  })

  it('keeps the previous geometry while the next viewport loads', async () => {
    let release: (value: FitnessRouteHeatmapTileBatch) => void = () => {}
    const fetchTiles = vi
      .fn()
      .mockImplementationOnce(async ({ tiles }) => batchOf(tiles))
      .mockImplementationOnce(
        () =>
          new Promise<FitnessRouteHeatmapTileBatch>((resolve) => {
            release = resolve
          })
      )
    const { result } = renderHook(() =>
      useHeatmapTiles({ tileSource, fetchTiles })
    )

    act(() => result.current.onViewChange({ zoom: 12, bounds }))
    await settle()
    await waitFor(() => expect(result.current.runs.length).toBeGreaterThan(0))
    const before = result.current.runs

    act(() =>
      result.current.onViewChange({
        zoom: 14,
        bounds: { minLat: 51, maxLat: 51.02, minLng: 4, maxLng: 4.03 }
      })
    )
    await settle()

    // Blanking here would read as breakage rather than loading.
    expect(result.current.runs).toBe(before)
    act(() => release({ version: 3, tiles: {} }))
  })

  it('restarts the view when the pyramid is rebuilt mid-load, rather than assembling half of it', async () => {
    // `missing` was computed against the OLD version, so the batches already
    // cached are unreachable under the new key prefix. Carrying on would draw a
    // view made of whatever happened to arrive after the switch.
    const fetchTiles = vi
      .fn(async ({ tiles }) => batchOf(tiles, 4))
      .mockImplementationOnce(async ({ tiles }) => batchOf(tiles, 3))
      .mockImplementationOnce(async ({ tiles }) => batchOf(tiles, 4))
    const { result } = renderHook(() =>
      useHeatmapTiles({ tileSource, fetchTiles })
    )

    act(() =>
      result.current.onViewChange({
        zoom: 6.01,
        bounds: { minLat: 45, maxLat: 55, minLng: 0, maxLng: 20 }
      })
    )
    await settle()
    await waitFor(() => expect(result.current.runs.length).toBeGreaterThan(0))

    // Every tile of the view is present, all at the new version — not just the
    // batches that happened to land after the switch.
    const finalRequests = fetchTiles.mock.calls
      .filter(([request]) => request.version === 4)
      .flatMap(([request]) => request.tiles)
    expect(result.current.runs).toHaveLength(finalRequests.length)
  })

  it('ignores a response answering an older version than it now holds', async () => {
    // A reply to a request this pass already superseded. Adopting it would
    // rewind the version and re-show the previous build's tiles.
    const fetchTiles = vi.fn(async ({ tiles }) => batchOf(tiles, 1))
    const { result } = renderHook(() =>
      useHeatmapTiles({ tileSource, fetchTiles })
    )

    act(() => result.current.onViewChange({ zoom: 12, bounds }))
    await settle()
    await waitFor(() => expect(fetchTiles).toHaveBeenCalled())

    expect(result.current.runs).toEqual([])
    expect(result.current.zoom).toBeNull()
  })

  it('coarsens a view too large for one request set instead of abandoning it', async () => {
    // An ordinary full-bleed embed reaches the ceiling, so refusing would strand
    // whatever was drawn before. Stepping DOWN the ladder trades detail for
    // coverage — the same trade the ladder itself makes for a wider view.
    const fetchTiles = vi.fn(async ({ tiles }) => batchOf(tiles))
    const { result } = renderHook(() =>
      useHeatmapTiles({ tileSource, fetchTiles })
    )

    act(() =>
      result.current.onViewChange({
        zoom: 16,
        bounds: { minLat: -60, maxLat: 70, minLng: -170, maxLng: 170 }
      })
    )
    await settle()
    await waitFor(() => expect(fetchTiles).toHaveBeenCalled())

    // Not the rung the view asked for, and small enough to be worth drawing.
    expect(result.current.zoom).toBeLessThan(16)
    const requested = fetchTiles.mock.calls.flatMap(([r]) => r.tiles)
    expect(requested.length).toBeLessThanOrEqual(MAX_TILES_PER_VIEW)
  })

  it('falls back to untiled geometry for a viewport that wraps the antimeridian', async () => {
    // `tilesForBounds` reports a wrap as a negative width and leaves the split
    // to its caller. Keeping the previous view's tiles drawn would show one
    // area's detail over ground the map is no longer looking at.
    const fetchTiles = vi.fn(async ({ tiles }) => batchOf(tiles))
    const { result } = renderHook(() =>
      useHeatmapTiles({ tileSource, fetchTiles })
    )

    act(() => result.current.onViewChange({ zoom: 12, bounds }))
    await settle()
    await waitFor(() => expect(result.current.runs.length).toBeGreaterThan(0))

    act(() =>
      result.current.onViewChange({
        zoom: 4,
        bounds: { minLat: -10, maxLat: 10, minLng: 170, maxLng: -170 }
      })
    )
    await settle()

    await waitFor(() => expect(result.current.runs).toEqual([]))
    expect(result.current.zoom).toBeNull()
  })

  it('re-asks for the current view when the pyramid version changes', async () => {
    // Every call into the hook comes from a map GESTURE. A pyramid that
    // finishes building while someone is looking at the map would otherwise
    // leave them on untiled geometry until they happened to pan.
    const fetchTiles = vi.fn(async ({ tiles }) => batchOf(tiles, 3))
    const { rerender, result } = renderHook(
      ({ source }) => useHeatmapTiles({ tileSource: source, fetchTiles }),
      { initialProps: { source: tileSource } }
    )

    act(() => result.current.onViewChange({ zoom: 12, bounds }))
    await settle()
    await waitFor(() => expect(fetchTiles).toHaveBeenCalledTimes(1))

    fetchTiles.mockImplementation(async ({ tiles }) => batchOf(tiles, 9))
    rerender({ source: { ...tileSource, version: 9 } })

    await waitFor(() => expect(fetchTiles).toHaveBeenCalledTimes(2))
    expect(fetchTiles.mock.calls[1][0].version).toBe(9)
  })

  it('holds at least a whole view, so a big view cannot evict itself', () => {
    // Not a tuning choice. Tiles are inserted batch by batch while a view
    // loads and eviction takes the oldest first, so a cache smaller than one
    // view would discard the batches it had already fetched and assemble a map
    // with holes it has no way to notice.
    expect(TILE_CACHE_MAX_TILES).toBeGreaterThan(MAX_TILES_PER_VIEW)
  })

  it('assembles a view larger than one request completely', async () => {
    const fetchTiles = vi.fn(async ({ tiles }) => batchOf(tiles))
    const { result } = renderHook(() =>
      useHeatmapTiles({ tileSource, fetchTiles })
    )

    act(() =>
      result.current.onViewChange({
        zoom: 6.01,
        bounds: { minLat: 45, maxLat: 55, minLng: 0, maxLng: 20 }
      })
    )
    await settle()
    await waitFor(() => expect(result.current.runs.length).toBeGreaterThan(0))

    // Every tile asked for came back in the drawn geometry — one run each.
    const requested = fetchTiles.mock.calls.flatMap(
      ([request]) => request.tiles
    )
    expect(result.current.runs).toHaveLength(requested.length)
  })

  it('leaves the previous view standing when a fetch fails', async () => {
    const fetchTiles = vi
      .fn(async () => {
        throw new Error('network down')
      })
      .mockImplementationOnce(async ({ tiles }) => batchOf(tiles))
    const { result } = renderHook(() =>
      useHeatmapTiles({ tileSource, fetchTiles })
    )

    act(() => result.current.onViewChange({ zoom: 12, bounds }))
    await settle()
    await waitFor(() => expect(result.current.runs.length).toBeGreaterThan(0))
    const before = result.current.runs

    act(() =>
      result.current.onViewChange({
        zoom: 14,
        bounds: { minLat: 51, maxLat: 51.02, minLng: 4, maxLng: 4.03 }
      })
    )
    await settle()
    await waitFor(() => expect(fetchTiles).toHaveBeenCalledTimes(2))

    // Detail on top of geometry the surface already drew: a failure costs the
    // detail, not the map.
    expect(result.current.runs).toBe(before)
  })
})
