/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import type { FitnessRouteHeatmapData } from '@/lib/client'
import { loadMapboxModule } from '@/lib/utils/mapbox'

import { RouteHeatmapMap } from './RouteHeatmapMap'

// Drive the map through a fake GL module so the test never touches a real CDN /
// Mapbox script (none load in jsdom). MapLibre is stubbed to a never-resolving
// loader because these tests always supply a Mapbox token.
vi.mock('@/lib/utils/mapbox', () => ({
  getPublicMapboxAccessToken: (token: string) => token,
  loadMapboxModule: vi.fn()
}))
vi.mock('@/lib/utils/maplibre', () => ({
  loadMaplibreModule: vi.fn(() => new Promise(() => {})),
  OPENFREEMAP_HEATMAP_STYLE_URL: 'https://tiles.openfreemap.org/styles/positron'
}))

type Handlers = Record<string, () => void>

// A fake Mapbox/MapLibre GL map: it fires its async 'load' once the component
// has subscribed (mirroring RegionMap.test's fake), so the load handler runs.
const createFakeGl = () => {
  const handlers: Handlers = {}
  const source = { setData: vi.fn() }
  const map = {
    on: vi.fn((event: string, callback: () => void) => {
      handlers[event] = callback
    }),
    remove: vi.fn(),
    resize: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    getSource: vi.fn(() => source),
    fitBounds: vi.fn()
  }
  const Map = vi.fn(function MapCtor() {
    Promise.resolve().then(() => handlers.load?.())
    return map
  })
  return { gl: { Map }, map, handlers }
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

    render(<RouteHeatmapMap heatmap={heatmap} mapboxAccessToken="pk.test" />)

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
      <RouteHeatmapMap heatmap={heatmap} mapboxAccessToken="pk.test" />
    )

    await screen.findByText('Mapbox')
    expect(resizeObservers[0].disconnect).not.toHaveBeenCalled()

    unmount()
    expect(resizeObservers[0].disconnect).toHaveBeenCalledTimes(1)
  })
})
