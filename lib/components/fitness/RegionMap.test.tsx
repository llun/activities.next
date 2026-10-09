/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { GlModule, RegionMap } from './RegionMap'

type Handlers = Record<string, (event?: unknown) => void>

const DEFAULT_BOX = {
  nw: { lat: 53, lng: 3 },
  se: { lat: 50, lng: 7 }
}

// Which library's attribution control the fake adds to the map container, in the
// state that library gives it on load: MapLibre's compact control is open for
// the first view (`maplibregl-compact-show`); Mapbox's starts folded.
const ATTRIBUTION_CLASSES = {
  maplibre:
    'maplibregl-ctrl maplibregl-ctrl-attrib maplibregl-compact maplibregl-compact-show',
  mapbox: 'mapboxgl-ctrl mapboxgl-ctrl-attrib mapboxgl-compact'
}

const createFakeGl = ({
  addSourceThrows = false,
  attribution = 'maplibre',
  autoLoad = true
}: {
  addSourceThrows?: boolean
  attribution?: keyof typeof ATTRIBUTION_CLASSES
  // Off: the test fires `handlers.load` itself, to look at what came before it.
  autoLoad?: boolean
} = {}) => {
  const handlers: Handlers = {}
  const source = { setData: vi.fn() }
  const attributionEl = document.createElement('details')
  attributionEl.className = ATTRIBUTION_CLASSES[attribution]
  let mapContainer: HTMLElement | null = null
  const map = {
    on: vi.fn((event: string, callback: (event?: unknown) => void) => {
      handlers[event] = callback
    }),
    remove: vi.fn(),
    resize: vi.fn(),
    addSource: vi.fn(() => {
      if (addSourceThrows) throw new Error('addSource failed')
    }),
    addLayer: vi.fn(),
    // The real control puts its element in the map's container as it is added.
    addControl: vi.fn(() => mapContainer?.appendChild(attributionEl)),
    getSource: vi.fn(() => source),
    getCanvas: vi.fn(() => ({ style: {} as CSSStyleDeclaration })),
    easeTo: vi.fn(),
    fitBounds: vi.fn(),
    dragPan: { enable: vi.fn(), disable: vi.fn() }
  }
  const Map = vi.fn(function MapCtor(options: { container: HTMLElement }) {
    mapContainer = options.container
    // Fire the async 'load' event after the component subscribes to it.
    if (autoLoad) Promise.resolve().then(() => handlers.load?.())
    return map
  })
  const AttributionControl = vi.fn(function AttributionControlCtor(_options: {
    compact: boolean
    customAttribution?: string
  }) {})
  const gl = { Map, AttributionControl } as unknown as GlModule
  return { gl, map, Map, source, handlers, attributionEl, AttributionControl }
}

const renderRegionMap = (
  gl: GlModule,
  overrides: Partial<Parameters<typeof RegionMap>[0]> = {}
) => {
  const onChange = vi.fn()
  const onUnavailable = vi.fn()
  const props = {
    box: DEFAULT_BOX,
    onChange,
    loadModule: () => Promise.resolve(gl),
    mapOptions: { style: 'test-style' },
    providerLabel: 'TestMaps',
    centerOnUser: false,
    onUnavailable,
    ...overrides
  }
  const utils = render(<RegionMap {...props} />)
  const rerenderWithBox = (box: Parameters<typeof RegionMap>[0]['box']) =>
    utils.rerender(<RegionMap {...props} box={box} />)
  return { onChange, onUnavailable, rerenderWithBox, ...utils }
}

describe('RegionMap', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    // @ts-expect-error reset between tests
    delete navigator.geolocation
  })

  it('shows a loading state until the map fires load', () => {
    const { gl } = createFakeGl()
    renderRegionMap(gl)
    expect(screen.getByText(/Loading map/i)).toBeInTheDocument()
  })

  it('renders the provider badge and draw control once the map loads', async () => {
    const { gl, map } = createFakeGl()
    renderRegionMap(gl)

    expect(await screen.findByText('TestMaps')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Draw/i })).toBeInTheDocument()
    expect(map.addSource).toHaveBeenCalledWith(
      'region-box',
      expect.objectContaining({ type: 'geojson' })
    )
    expect(map.addLayer).toHaveBeenCalledTimes(2)
  })

  it('adds a compact attribution control to the map instead of the default one', async () => {
    const { gl, map, Map, AttributionControl } = createFakeGl()
    renderRegionMap(gl)

    await screen.findByText('TestMaps')
    // Not the Map's own `attributionControl: true`: on Mapbox that option is a
    // boolean, and its default control folds by the map's width alone — the
    // picker's map is 846px wide at 1280, so the credit stayed a wide open bar.
    // The same explicit `compact` control keeps the "i" button on both libraries.
    expect(gl.Map).toHaveBeenCalledWith(
      expect.objectContaining({ attributionControl: false })
    )
    expect(AttributionControl).toHaveBeenCalledTimes(1)
    expect(AttributionControl.mock.calls[0][0]).toMatchObject({ compact: true })
    expect(map.addControl).toHaveBeenCalledTimes(1)
    expect(map.addControl).toHaveBeenCalledWith(
      AttributionControl.mock.instances[0]
    )
    // Added after the map exists, and before it can load.
    expect(Map.mock.invocationCallOrder[0]).toBeLessThan(
      map.addControl.mock.invocationCallOrder[0]
    )
  })

  // MapLibre's own default control credits MapLibre ahead of the style's
  // sources ("MapLibre | OpenFreeMap © OpenMapTiles Data from OpenStreetMap");
  // a control built by hand does not unless it is given that as
  // `customAttribution`, so the caller's credit goes through to it. Mapbox has
  // no such credit and the caller gives none.
  it('gives the control the library credit the caller passes', async () => {
    const { gl, AttributionControl } = createFakeGl()
    const credit =
      '<a href="https://maplibre.org/" target="_blank">MapLibre</a>'
    renderRegionMap(gl, { customAttribution: credit })

    await screen.findByText('TestMaps')
    expect(AttributionControl).toHaveBeenCalledWith({
      compact: true,
      customAttribution: credit
    })
  })

  it('adds no library credit when the caller has none', async () => {
    const { gl, AttributionControl } = createFakeGl({ attribution: 'mapbox' })
    renderRegionMap(gl)

    await screen.findByText('TestMaps')
    expect(
      AttributionControl.mock.calls[0][0].customAttribution
    ).toBeUndefined()
  })

  // MapLibre 4.7 opens a compact control for the first view and only folds it on
  // the first drag, so the credit was a wide bar over the map at load. Its own
  // click handler opens it again from the folded state, so the class is all that
  // has to go; `maplibregl-compact` is what keeps it the "i" button.
  it('folds the MapLibre credit to the "i" button once the map loads', async () => {
    const { gl, attributionEl } = createFakeGl()
    expect(attributionEl).toHaveClass('maplibregl-compact-show')
    renderRegionMap(gl)

    await screen.findByText('TestMaps')
    expect(attributionEl).toHaveClass('maplibregl-compact')
    expect(attributionEl).not.toHaveClass('maplibregl-compact-show')
  })

  // The credit is open from the moment the control is added until the map loads
  // (about 0.7s on a cold start), which is when the "Loading map…" overlay is up:
  // it is folded as soon as it exists.
  it('folds the MapLibre credit as soon as the control is added, before the map loads', async () => {
    const { gl, map, attributionEl, handlers } = createFakeGl({
      autoLoad: false
    })
    renderRegionMap(gl)

    await waitFor(() => expect(map.addControl).toHaveBeenCalled())
    expect(handlers.load).toBeDefined()
    expect(screen.getByText(/Loading map/i)).toBeInTheDocument()
    expect(attributionEl).toHaveClass('maplibregl-compact')
    expect(attributionEl).not.toHaveClass('maplibregl-compact-show')
  })

  it("folds the credit again on load when the control started empty and MapLibre opened it for the style's credits", async () => {
    const { gl, map, attributionEl, handlers } = createFakeGl({
      autoLoad: false
    })
    renderRegionMap(gl)
    await waitFor(() => expect(map.addControl).toHaveBeenCalled())

    // No `customAttribution` here, so the control started empty: the style's
    // credits arrive, and MapLibre opens it for them.
    attributionEl.classList.add('maplibregl-compact-show')
    act(() => handlers.load?.())

    expect(await screen.findByText('TestMaps')).toBeInTheDocument()
    expect(attributionEl).not.toHaveClass('maplibregl-compact-show')
  })

  it('leaves the Mapbox credit as the library folded it', async () => {
    const { gl, attributionEl } = createFakeGl({ attribution: 'mapbox' })
    renderRegionMap(gl)

    await screen.findByText('TestMaps')
    expect(attributionEl.className).toBe(ATTRIBUTION_CLASSES.mapbox)
  })

  describe('credit lift', () => {
    // jsdom lays nothing out: hand the hint pill a height, and watch what the
    // component observes.
    let hintHeight = 24.5
    let observers: Array<{
      callback: () => void
      observed: Element[]
      disconnect: () => void
    }> = []

    class ResizeObserverStub {
      readonly entry: (typeof observers)[number]

      constructor(callback: () => void) {
        this.entry = { callback, observed: [], disconnect: vi.fn() }
        observers.push(this.entry)
      }

      observe(target: Element) {
        this.entry.observed.push(target)
      }

      disconnect() {
        this.entry.disconnect()
      }
    }

    beforeEach(() => {
      hintHeight = 24.5
      observers = []
      vi.stubGlobal('ResizeObserver', ResizeObserverStub)
      vi.spyOn(
        HTMLElement.prototype,
        'getBoundingClientRect'
      ).mockImplementation(function (this: HTMLElement) {
        const isHint = this.className.includes('inset-x-2')
        return { height: isHint ? hintHeight : 0 } as DOMRect
      })
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    const getLift = (container: HTMLElement) =>
      (container.firstElementChild as HTMLElement).style.getPropertyValue(
        '--region-credit-lift'
      )

    // The credit's bottom edge from the map's: the hint's inset (8) and height,
    // the 12px the design draws above it, less the control's own 10px margin.
    it('puts the credit 12px above the hint it measured', async () => {
      const { gl } = createFakeGl()
      const { container } = renderRegionMap(gl)

      // Before the hint exists the lift assumes a one-line hint, so the map's
      // first frame is already in place.
      expect(getLift(container)).toBe('35px')

      await screen.findByText('TestMaps')
      // 8 + 24.5 + 12 - 10: the control's 44.5px from the map's bottom edge is
      // 12px above the hint's top edge, which is 32.5px up.
      await waitFor(() => expect(getLift(container)).toBe('34.5px'))
    })

    it('follows the hint to a second line on a phone, and back', async () => {
      const { gl } = createFakeGl()
      const { container } = renderRegionMap(gl)
      await screen.findByText('TestMaps')
      await waitFor(() => expect(getLift(container)).toBe('34.5px'))

      hintHeight = 41
      act(() => observers[0].callback())
      expect(getLift(container)).toBe('51px')

      hintHeight = 24.5
      act(() => observers[0].callback())
      expect(getLift(container)).toBe('34.5px')
    })

    it('observes the hint itself and stops when the map goes away', async () => {
      const { gl, map, handlers } = createFakeGl({ autoLoad: false })
      const { unmount } = renderRegionMap(gl)
      await waitFor(() => expect(map.addControl).toHaveBeenCalled())

      // Load inside act(), which flushes the effect that observes the hint
      // before the count below. `findByText` resolves on the commit that
      // renders the hint, and React runs that commit's effects in a later
      // Scheduler task: on a busy runner the count ran first and saw none.
      act(() => handlers.load?.())
      expect(screen.getByText('TestMaps')).toBeInTheDocument()

      expect(observers).toHaveLength(1)
      expect(observers[0].observed).toHaveLength(1)
      expect(observers[0].observed[0].textContent).toBe(
        'Pan and zoom, then press Draw to select an area.'
      )

      unmount()
      expect(observers[0].disconnect).toHaveBeenCalled()
    })

    it('keeps the first guess when nothing is laid out', async () => {
      hintHeight = 0
      const { gl } = createFakeGl()
      const { container } = renderRegionMap(gl)
      await screen.findByText('TestMaps')
      // Let the measuring effect run, so the check below is not just the first
      // render's value.
      await act(async () => {})

      expect(getLift(container)).toBe('35px')
    })

    it('measures once without a ResizeObserver', async () => {
      vi.unstubAllGlobals()
      const { gl } = createFakeGl()
      const { container } = renderRegionMap(gl)
      await screen.findByText('TestMaps')

      await waitFor(() => expect(getLift(container)).toBe('34.5px'))
    })
  })

  it('disables panning while in draw mode', async () => {
    const { gl, map } = createFakeGl()
    renderRegionMap(gl)

    const drawButton = await screen.findByRole('button', { name: /Draw/i })
    fireEvent.click(drawButton)

    expect(map.dragPan.disable).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Drawing/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('updates the box from a drag while drawing', async () => {
    const { gl, handlers } = createFakeGl()
    const { onChange } = renderRegionMap(gl)

    fireEvent.click(await screen.findByRole('button', { name: /Draw/i }))

    handlers.mousedown?.({
      lngLat: { lat: 10, lng: 20 },
      preventDefault: vi.fn()
    })
    handlers.mousemove?.({
      lngLat: { lat: 5, lng: 25 },
      preventDefault: vi.fn()
    })
    handlers.mouseup?.()

    expect(onChange).toHaveBeenLastCalledWith({
      nw: { lat: 10, lng: 20 },
      se: { lat: 5, lng: 25 }
    })
  })

  it('centers on the user and seeds a starting area for a new region', async () => {
    const getCurrentPosition = vi.fn((success) =>
      success({ coords: { latitude: 40, longitude: -70 } })
    )
    // @ts-expect-error partial geolocation stub
    navigator.geolocation = { getCurrentPosition }

    const { gl, map } = createFakeGl()
    const { onChange } = renderRegionMap(gl, { centerOnUser: true })

    await screen.findByText('TestMaps')
    expect(getCurrentPosition).toHaveBeenCalled()
    expect(map.easeTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [-70, 40] })
    )
    expect(onChange).toHaveBeenCalledWith({
      nw: { lat: 40.05, lng: -70.05 },
      se: { lat: 39.95, lng: -69.95 }
    })
  })

  it('calls onUnavailable when the module fails to load', async () => {
    const onUnavailable = vi.fn()
    render(
      <RegionMap
        box={DEFAULT_BOX}
        onChange={vi.fn()}
        loadModule={() => Promise.reject(new Error('boom'))}
        mapOptions={{ style: 'test-style' }}
        providerLabel="TestMaps"
        centerOnUser={false}
        onUnavailable={onUnavailable}
      />
    )

    await waitFor(() => expect(onUnavailable).toHaveBeenCalled())
  })

  it('calls onUnavailable when building the map layers throws', async () => {
    const { gl } = createFakeGl({ addSourceThrows: true })
    const { onUnavailable } = renderRegionMap(gl)
    await waitFor(() => expect(onUnavailable).toHaveBeenCalled())
  })

  it('pushes box changes into the map source after load', async () => {
    const { gl, source } = createFakeGl()
    const { rerenderWithBox } = renderRegionMap(gl)

    await screen.findByText('TestMaps')
    source.setData.mockClear()
    rerenderWithBox({ nw: { lat: 20, lng: 10 }, se: { lat: 18, lng: 14 } })

    expect(source.setData).toHaveBeenCalledWith(
      expect.objectContaining({
        geometry: expect.objectContaining({
          coordinates: [
            [
              [10, 20],
              [14, 20],
              [14, 18],
              [10, 18],
              [10, 20]
            ]
          ]
        })
      })
    )
  })

  it('fits the map to the existing box when editing (centerOnUser false)', async () => {
    const { gl, map } = createFakeGl()
    renderRegionMap(gl, { centerOnUser: false })

    await screen.findByText('TestMaps')
    // DEFAULT_BOX nw {53,3} / se {50,7} -> bounds [[west, south], [east, north]].
    expect(map.fitBounds).toHaveBeenCalledWith(
      [
        [3, 50],
        [7, 53]
      ],
      expect.any(Object)
    )
  })

  it('frames the box for a new area when geolocation is unavailable', async () => {
    // No navigator.geolocation stub: the new-area path can't center on the user,
    // so it must still frame the seeded/default box instead of a world view.
    const { gl, map } = createFakeGl()
    renderRegionMap(gl, { centerOnUser: true })

    await screen.findByText('TestMaps')
    expect(map.fitBounds).toHaveBeenCalledWith(
      [
        [3, 50],
        [7, 53]
      ],
      expect.any(Object)
    )
    expect(map.easeTo).not.toHaveBeenCalled()
  })

  it('ignores multi-touch gestures so pinch-zoom does not start a draw', async () => {
    const { gl, handlers } = createFakeGl()
    const { onChange } = renderRegionMap(gl)

    fireEvent.click(await screen.findByRole('button', { name: /Draw/i }))
    onChange.mockClear()
    handlers.touchstart?.({
      lngLat: { lat: 1, lng: 2 },
      originalEvent: { touches: { length: 2 } }
    })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('re-enables panning when draw mode is toggled off', async () => {
    const { gl, map } = createFakeGl()
    renderRegionMap(gl)

    fireEvent.click(await screen.findByRole('button', { name: /Draw/i }))
    fireEvent.click(screen.getByRole('button', { name: /Drawing/i }))

    expect(map.dragPan.enable).toHaveBeenCalled()
  })

  it('recenters on the user when the locate button is pressed', async () => {
    const getCurrentPosition = vi.fn((success) =>
      success({ coords: { latitude: 1, longitude: 2 } })
    )
    // @ts-expect-error partial geolocation stub
    navigator.geolocation = { getCurrentPosition }

    const { gl, map } = createFakeGl()
    renderRegionMap(gl, { centerOnUser: false })
    await screen.findByText('TestMaps')

    fireEvent.click(
      screen.getByRole('button', { name: /Center on my location/i })
    )
    expect(getCurrentPosition).toHaveBeenCalled()
    expect(map.easeTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [2, 1] })
    )
  })

  it('ignores a geolocation result that arrives after unmount', async () => {
    let success:
      ((position: { coords: GeolocationCoordinates }) => void) | null = null
    const getCurrentPosition = vi.fn((callback) => {
      success = callback
    })
    // @ts-expect-error partial geolocation stub
    navigator.geolocation = { getCurrentPosition }

    const { gl, map } = createFakeGl()
    const { unmount } = renderRegionMap(gl, { centerOnUser: true })
    await screen.findByText('TestMaps')
    expect(getCurrentPosition).toHaveBeenCalled()

    unmount()
    map.easeTo.mockClear()
    ;(
      success as ((position: { coords: GeolocationCoordinates }) => void) | null
    )?.({
      coords: { latitude: 5, longitude: 6 } as GeolocationCoordinates
    })

    expect(map.easeTo).not.toHaveBeenCalled()
  })
})
