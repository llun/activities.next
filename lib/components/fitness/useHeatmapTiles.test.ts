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

  it('serves a viewport that wraps the antimeridian, from both sides of it', async () => {
    // `tilesForBounds` reports a wrap as `minX > maxX` and leaves the split to
    // its caller. Without doing it, everyone whose home view contains 180
    // degrees — Fiji, Chukotka, the Chathams — was stuck on the whole-history
    // geometry forever while a neighbour 20 km west got street detail.
    const fetchTiles = vi.fn(async ({ tiles }) => batchOf(tiles))
    const { result } = renderHook(() =>
      useHeatmapTiles({ tileSource, fetchTiles })
    )

    act(() =>
      result.current.onViewChange({
        zoom: 8,
        bounds: { minLat: -18.2, maxLat: -18.1, minLng: 179.9, maxLng: -179.9 }
      })
    )
    await settle()
    await waitFor(() => expect(fetchTiles).toHaveBeenCalled())

    const xs = fetchTiles.mock.calls
      .flatMap(([request]) => request.tiles)
      .map((tile: { x: number }) => tile.x)
    const lastColumn = 2 ** fetchTiles.mock.calls[0][0].z - 1
    // Columns from both ends of the world, which is what a wrap means.
    expect(Math.min(...xs)).toBe(0)
    expect(Math.max(...xs)).toBe(lastColumn)
    await waitFor(() => expect(result.current.runs.length).toBeGreaterThan(0))
  })

  it('covers a near-world span instead of collapsing it to one column', async () => {
    // A raw span within one column-width of the world normalises into the SAME
    // column at both ends. Reading coverage from that pair alone fetched one
    // sixteenth of a world view and — because tiles then existed — blanked the
    // untiled geometry, so the reader saw a single 22.5 degree strip and
    // nothing else, with no error.
    const fetchTiles = vi.fn(async ({ tiles }) => batchOf(tiles))
    const { result } = renderHook(() =>
      useHeatmapTiles({ tileSource, fetchTiles })
    )

    act(() =>
      result.current.onViewChange({
        zoom: 2.36,
        bounds: { minLat: -60, maxLat: 60, minLng: -75, maxLng: 275 }
      })
    )
    await settle()
    await waitFor(() => expect(fetchTiles).toHaveBeenCalled())

    const xs = new Set(
      fetchTiles.mock.calls
        .flatMap(([request]) => request.tiles)
        .map((tile: { x: number }) => tile.x)
    )
    // 350 degrees at the z4 floor is essentially the whole world: 16 columns.
    expect(xs.size).toBe(2 ** fetchTiles.mock.calls[0][0].z)
  })

  it('refuses a viewport spanning a whole world or more', async () => {
    // `projectWebMercator` normalises each end independently, so 540 degrees of
    // longitude collapses to a sliver that would be drawn as the entire map.
    // The raw span has to be rejected before normalisation hides it.
    const fetchTiles = vi.fn(async ({ tiles }) => batchOf(tiles))
    const { result } = renderHook(() =>
      useHeatmapTiles({ tileSource, fetchTiles })
    )

    act(() => result.current.onViewChange({ zoom: 12, bounds }))
    await settle()
    await waitFor(() => expect(result.current.runs.length).toBeGreaterThan(0))

    act(() =>
      result.current.onViewChange({
        zoom: 1,
        bounds: { minLat: -80, maxLat: 80, minLng: -270, maxLng: 270 }
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

  it('keeps the ceiling within reach of a real viewport', () => {
    // Pinned from ABOVE as well as below. The lower bound alone is satisfied by
    // any huge number, so a ceiling of 100_000 — which would let a pathological
    // view enumerate and fetch forever — would pass unnoticed.
    expect(MAX_TILES_PER_VIEW).toBeLessThanOrEqual(2048)
    expect(TILE_CACHE_MAX_TILES).toBeLessThanOrEqual(4096)
  })

  it('coarsens exactly one rung at a time, rather than jumping to the bottom', async () => {
    // A view that overflows only at the finest rung must land on the NEXT rung
    // down, not on z4. Walking the ladder is the whole point: each step trades
    // a fixed amount of detail for a quarter of the tiles.
    const fetchTiles = vi.fn(async ({ tiles }) => batchOf(tiles))
    const { result } = renderHook(() =>
      useHeatmapTiles({ tileSource, fetchTiles })
    )

    // ~0.35 degrees at view zoom 15: 16 needs >1024 tiles, 14 fits.
    act(() =>
      result.current.onViewChange({
        zoom: 15,
        bounds: { minLat: 52, maxLat: 52.35, minLng: 5.6, maxLng: 5.95 }
      })
    )
    await settle()
    await waitFor(() => expect(fetchTiles).toHaveBeenCalled())

    expect(fetchTiles.mock.calls[0][0].z).toBe(14)
  })

  it('draws again after a view it had to abandon', async () => {
    // The clear path resets the signature as well as the state. Forgetting it
    // would make the abandoned view's signature match the next good one, and
    // the map would stay blank for as long as the reader stayed in that area.
    const fetchTiles = vi.fn(async ({ tiles }) => batchOf(tiles))
    const { result } = renderHook(() =>
      useHeatmapTiles({ tileSource, fetchTiles })
    )

    act(() => result.current.onViewChange({ zoom: 12, bounds }))
    await settle()
    await waitFor(() => expect(result.current.runs.length).toBeGreaterThan(0))

    act(() =>
      result.current.onViewChange({
        zoom: 1,
        bounds: { minLat: -80, maxLat: 80, minLng: -270, maxLng: 270 }
      })
    )
    await settle()
    await waitFor(() => expect(result.current.runs).toEqual([]))

    act(() => result.current.onViewChange({ zoom: 12, bounds }))
    await settle()
    await waitFor(() => expect(result.current.runs.length).toBeGreaterThan(0))
  })

  it('does not coarsen an ordinary desktop viewport', () => {
    // Coarsening costs a whole rung of detail, so the ceiling has to sit above
    // what a real map asks for rather than below it. Measured at the least
    // favourable ladder rounding: 273 tiles at 1280x720, 558 at 1920x1080,
    // 984 at 2560x1440.
    const worstCaseFor = (width: number, height: number) => {
      let worst = 0
      for (const glZoom of [3.01, 5.01, 7.01, 9.01, 11.01, 13.01, 15.01]) {
        const view = glZoom + 1
        const z = storedZoomForView(view)
        const scale = 2 ** (z - view)
        worst = Math.max(
          worst,
          (Math.ceil((width / 256) * scale) + 1) *
            (Math.ceil((height / 256) * scale) + 1)
        )
      }
      return worst
    }

    expect(worstCaseFor(1280, 720)).toBeLessThanOrEqual(MAX_TILES_PER_VIEW)
    expect(worstCaseFor(1920, 1080)).toBeLessThanOrEqual(MAX_TILES_PER_VIEW)
    expect(worstCaseFor(2560, 1440)).toBeLessThanOrEqual(MAX_TILES_PER_VIEW)
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
