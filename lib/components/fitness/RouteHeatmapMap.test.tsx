/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'

import type { FitnessRouteHeatmapData } from '@/lib/client'
import {
  HEAT_COUNT_SATURATION,
  HEAT_VISIBLE_BASE_OPACITY,
  TILE_EXTENT,
  heatOpacityForCount
} from '@/lib/services/fitness-files/heatmapTiles/constants'
import { encodeTile } from '@/lib/services/fitness-files/heatmapTiles/tileCodec'
import { loadMapboxModule } from '@/lib/utils/mapbox'

import { RouteHeatmapMap, tileOpacityStops } from './RouteHeatmapMap'

// Drive the map through a fake GL module so the test never touches a real CDN /
// Mapbox script (none load in jsdom). MapLibre is stubbed to a never-resolving
// loader because these tests always supply a Mapbox token.
vi.mock('@/lib/utils/mapbox', () => ({
  loadMapboxModule: vi.fn()
}))
vi.mock('@/lib/utils/maplibre', () => ({
  loadMaplibreModule: vi.fn(() => new Promise(() => {})),
  OPENFREEMAP_STYLE_URL: 'https://tiles.openfreemap.org/styles/bright',
  OPENFREEMAP_HEATMAP_STYLE_URL: 'https://tiles.openfreemap.org/styles/positron'
}))

type Handlers = Record<string, () => void>

// A fake Mapbox/MapLibre GL map: it fires its async 'load' once the component
// has subscribed (mirroring RegionMap.test's fake), so the load handler runs.
const createFakeGl = (
  view: { zoom: number; bounds: [number, number, number, number] } = {
    zoom: 12,
    bounds: [5.6, 52, 5.73, 52.13]
  }
) => {
  const handlers: Handlers = {}
  const source = { setData: vi.fn() }
  // Two sources now: the untiled blob and the tiled geometry. Keyed, because a
  // shared double would let the last write win and hide which one was fed.
  const sources: Record<string, { setData: ReturnType<typeof vi.fn> }> = {
    'route-heatmap': source,
    'route-heatmap-tiles': { setData: vi.fn() }
  }
  const map = {
    on: vi.fn((event: string, callback: () => void) => {
      handlers[event] = callback
    }),
    off: vi.fn(),
    getZoom: vi.fn(() => view.zoom),
    getBounds: vi.fn(() => ({
      getWest: () => view.bounds[0],
      getSouth: () => view.bounds[1],
      getEast: () => view.bounds[2],
      getNorth: () => view.bounds[3]
    })),
    remove: vi.fn(),
    resize: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    getSource: vi.fn((id: string) => sources[id] ?? source),
    fitBounds: vi.fn()
  }
  const Map = vi.fn(function MapCtor() {
    Promise.resolve().then(() => handlers.load?.())
    return map
  })
  return { gl: { Map }, map, handlers, sources }
}

// Local stand-in for the lib.dom ResizeObserverCallback type — eslint's
// no-undef doesn't recognise that type name in this config (the ResizeObserver
// value global is fine).
type ResizeObserverCallbackFn = (entries: unknown[], observer: unknown) => void

// jsdom ships no ResizeObserver; record instances so a test can fire a
// container-size change and assert the map re-fits its canvas.
interface FakeResizeObserver {
  callback: ResizeObserverCallbackFn
  observe: ReturnType<typeof vi.fn>
  unobserve: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}
let resizeObservers: FakeResizeObserver[] = []

const mockLoadMapboxModule = loadMapboxModule as jest.MockedFunction<
  typeof loadMapboxModule
>

const heatmap: FitnessRouteHeatmapData = {
  id: 'hm-1',
  region: '',
  periodType: 'all_time',
  periodKey: 'all',
  status: 'completed',
  bounds: { minLat: 52, maxLat: 52.6, minLng: 5.6, maxLng: 6.2 },
  segments: [
    {
      points: [
        { lat: 52, lng: 5.6 },
        { lat: 52.6, lng: 6.2 }
      ]
    }
  ],
  activityCount: 12,
  pointCount: 340,
  totalCount: 20,
  cursorOffset: 20,
  isPartial: false,
  error: null,
  createdAt: 1,
  updatedAt: 2
}

beforeEach(() => {
  resizeObservers = []
  class MockResizeObserver {
    callback: ResizeObserverCallbackFn
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
    constructor(callback: ResizeObserverCallbackFn) {
      this.callback = callback
      resizeObservers.push(this)
    }
  }
  globalThis.ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver
})

afterEach(() => {
  vi.clearAllMocks()
  // Restore the absent global between tests (jsdom ships no ResizeObserver).
  Reflect.deleteProperty(globalThis, 'ResizeObserver')
})

describe('RouteHeatmapMap', () => {
  it('resizes the GL canvas when its container changes size', async () => {
    const { gl, map } = createFakeGl()
    mockLoadMapboxModule.mockResolvedValue(gl as never)

    render(
      <RouteHeatmapMap
        heatmap={heatmap}
        mapProvider={{ type: 'mapbox', accessToken: 'pk.test' }}
      />
    )

    // The provider badge only renders once the map fires 'load'.
    await screen.findByText('Mapbox')
    // The load handler resizes once; the container is now observed.
    expect(map.resize).toHaveBeenCalledTimes(1)
    expect(resizeObservers).toHaveLength(1)
    expect(resizeObservers[0].observe).toHaveBeenCalledTimes(1)

    // Simulate the embed preview swapping width (Small → Large): the observer
    // fires and the map must resize so the canvas refills the new container.
    resizeObservers[0].callback(
      [],
      resizeObservers[0] as unknown as ResizeObserver
    )
    expect(map.resize).toHaveBeenCalledTimes(2)
  })

  it('disconnects the resize observer when unmounted', async () => {
    const { gl } = createFakeGl()
    mockLoadMapboxModule.mockResolvedValue(gl as never)

    const { unmount } = render(
      <RouteHeatmapMap
        heatmap={heatmap}
        mapProvider={{ type: 'mapbox', accessToken: 'pk.test' }}
      />
    )

    await screen.findByText('Mapbox')
    expect(resizeObservers[0].disconnect).not.toHaveBeenCalled()

    unmount()
    expect(resizeObservers[0].disconnect).toHaveBeenCalledTimes(1)
  })

  it('mounts without observing when the environment has no ResizeObserver', async () => {
    // SSR / older environments expose no ResizeObserver; the feature-detect
    // guard must skip observing rather than throw, and the map must still load.
    Reflect.deleteProperty(globalThis, 'ResizeObserver')
    const { gl, map } = createFakeGl()
    mockLoadMapboxModule.mockResolvedValue(gl as never)

    render(
      <RouteHeatmapMap
        heatmap={heatmap}
        mapProvider={{ type: 'mapbox', accessToken: 'pk.test' }}
      />
    )

    // The map loaded (resizing once on 'load') without constructing an observer.
    await screen.findByText('Mapbox')
    expect(map.resize).toHaveBeenCalledTimes(1)
    expect(resizeObservers).toHaveLength(0)
  })
})

describe('tileOpacityStops', () => {
  it('is generated from heatOpacityForCount, not copied out of it', () => {
    // The server documents the ramp with that function. Copying its numbers
    // here would let the two drift silently.
    expect(tileOpacityStops(HEAT_VISIBLE_BASE_OPACITY)).toEqual(
      Array.from(
        { length: HEAT_COUNT_SATURATION },
        (_unused, i) => i + 1
      ).flatMap((count) => [
        count,
        heatOpacityForCount(count, HEAT_VISIBLE_BASE_OPACITY)
      ])
    )
  })

  it('rises strictly with the count, which a GL interpolate requires', () => {
    const stops = tileOpacityStops(HEAT_VISIBLE_BASE_OPACITY)
    const inputs = stops.filter((_unused, index) => index % 2 === 0)
    const outputs = stops.filter((_unused, index) => index % 2 === 1)
    for (let i = 1; i < inputs.length; i += 1) {
      // GL rejects a stop list whose inputs are not ascending.
      expect(inputs[i]).toBeGreaterThan(inputs[i - 1])
      expect(outputs[i]).toBeGreaterThan(outputs[i - 1])
    }
  })
})

describe('RouteHeatmapMap tiled rendering', () => {
  const tileSource = {
    version: 2,
    minZoom: 4,
    maxZoom: 16,
    ladder: [4, 6, 8, 10, 12, 14, 16],
    extent: TILE_EXTENT
  }
  const tiled: FitnessRouteHeatmapData = { ...heatmap, tileSource }

  const tilePayload = encodeTile([{ count: 5, points: [0, 0, 32, 32] }])
  const fetchAll = () =>
    vi.fn(async ({ tiles }: { tiles: Array<{ x: number; y: number }> }) => ({
      version: 2,
      tiles: Object.fromEntries(
        tiles.map(({ x, y }) => [`${x}:${y}`, tilePayload])
      )
    }))

  const lastData = (setData: ReturnType<typeof vi.fn>) =>
    setData.mock.calls[setData.mock.calls.length - 1]?.[0] as {
      features: Array<{ properties: { count: number } }>
    }

  it('asks for the tiles its opening view covers, without waiting for a pan', async () => {
    // fitBounds is what first gives the map a viewport; without reporting it
    // the map would sit on untiled geometry until the reader happened to pan.
    const { gl } = createFakeGl()
    vi.mocked(loadMapboxModule).mockResolvedValue(gl as never)
    const fetchTiles = fetchAll()

    render(
      <RouteHeatmapMap
        heatmap={tiled}
        mapProvider={{ type: 'mapbox', accessToken: 'pk.test' }}
        fetchTiles={fetchTiles}
      />
    )

    await waitFor(() => expect(fetchTiles).toHaveBeenCalled())
    // The double reports GL zoom 12, which is 13 on the pyramid's 256px grid,
    // and 13 rounds up to the z14 rung.
    expect(fetchTiles.mock.calls[0][0].z).toBe(14)
    expect(fetchTiles.mock.calls[0][0].version).toBe(2)
  })

  it('draws the tiles and empties the untiled source, never both', async () => {
    // The two describe the same roads at different fidelities, so drawing both
    // renders every line at twice its opacity.
    const { gl, sources } = createFakeGl()
    vi.mocked(loadMapboxModule).mockResolvedValue(gl as never)

    render(
      <RouteHeatmapMap
        heatmap={tiled}
        mapProvider={{ type: 'mapbox', accessToken: 'pk.test' }}
        fetchTiles={fetchAll()}
      />
    )

    await waitFor(() =>
      expect(
        lastData(sources['route-heatmap-tiles'].setData).features.length
      ).toBeGreaterThan(0)
    )
    expect(lastData(sources['route-heatmap'].setData).features).toEqual([])
  })

  it('carries the visit count into the geometry the paint reads', async () => {
    const { gl, sources } = createFakeGl()
    vi.mocked(loadMapboxModule).mockResolvedValue(gl as never)

    render(
      <RouteHeatmapMap
        heatmap={tiled}
        mapProvider={{ type: 'mapbox', accessToken: 'pk.test' }}
        fetchTiles={fetchAll()}
      />
    )

    await waitFor(() =>
      expect(
        lastData(sources['route-heatmap-tiles'].setData).features.length
      ).toBeGreaterThan(0)
    )
    const [feature] = lastData(sources['route-heatmap-tiles'].setData).features
    expect(feature.properties.count).toBe(5)
  })

  it('paints the tile layer off the count property', async () => {
    // Renaming the property the paint reads would silently flatten the ramp to
    // its fallback, with every street the same colour.
    const { gl, map } = createFakeGl()
    vi.mocked(loadMapboxModule).mockResolvedValue(gl as never)

    render(
      <RouteHeatmapMap
        heatmap={tiled}
        mapProvider={{ type: 'mapbox', accessToken: 'pk.test' }}
        fetchTiles={fetchAll()}
      />
    )

    await waitFor(() => expect(map.addLayer).toHaveBeenCalled())
    const layer = map.addLayer.mock.calls
      .map(([definition]) => definition as { id: string; paint: unknown })
      .find((definition) => definition.id === 'route-heatmap-tile-lines')
    expect(JSON.stringify(layer?.paint)).toContain('"count"')
  })

  it('stays entirely on the untiled path for a heatmap with no pyramid', async () => {
    // Every heatmap generated before the pyramid existed, and every variant it
    // cannot answer, still renders exactly as it did.
    const { gl, sources } = createFakeGl()
    vi.mocked(loadMapboxModule).mockResolvedValue(gl as never)
    const fetchTiles = fetchAll()

    render(
      <RouteHeatmapMap
        heatmap={heatmap}
        mapProvider={{ type: 'mapbox', accessToken: 'pk.test' }}
        fetchTiles={fetchTiles}
      />
    )

    await waitFor(() =>
      expect(sources['route-heatmap'].setData).toHaveBeenCalled()
    )
    expect(fetchTiles).not.toHaveBeenCalled()
    expect(lastData(sources['route-heatmap'].setData).features.length).toBe(1)
  })

  it('reports a settled pan so the next view is fetched', async () => {
    const view = {
      zoom: 12,
      bounds: [5.6, 52, 5.73, 52.13] as [number, number, number, number]
    }
    const { gl, handlers } = createFakeGl(view)
    vi.mocked(loadMapboxModule).mockResolvedValue(gl as never)
    const fetchTiles = fetchAll()

    render(
      <RouteHeatmapMap
        heatmap={tiled}
        mapProvider={{ type: 'mapbox', accessToken: 'pk.test' }}
        fetchTiles={fetchTiles}
      />
    )
    await waitFor(() => expect(fetchTiles).toHaveBeenCalled())

    // Somewhere else entirely, at a zoom that lands on a different rung: GL 15
    // is 16 on the pyramid's grid, where GL 12 was 13 -> rung 14.
    view.zoom = 15
    view.bounds = [4.0, 51.0, 4.017, 51.017]
    handlers.moveend?.()

    await waitFor(() =>
      expect(fetchTiles.mock.calls.map(([request]) => request.z)).toContain(16)
    )
  })
})
