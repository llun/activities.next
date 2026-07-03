/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { GlModule, RegionMap } from './RegionMap'

type Handlers = Record<string, (event?: unknown) => void>

const DEFAULT_BOX = {
  nw: { lat: 53, lng: 3 },
  se: { lat: 50, lng: 7 }
}

const createFakeGl = ({ addSourceThrows = false } = {}) => {
  const handlers: Handlers = {}
  const source = { setData: vi.fn() }
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
    getSource: vi.fn(() => source),
    getCanvas: vi.fn(() => ({ style: {} as CSSStyleDeclaration })),
    easeTo: vi.fn(),
    fitBounds: vi.fn(),
    dragPan: { enable: vi.fn(), disable: vi.fn() }
  }
  const Map = vi.fn(function MapCtor() {
    // Fire the async 'load' event after the component subscribes to it.
    Promise.resolve().then(() => handlers.load?.())
    return map
  })
  const gl = { Map } as unknown as GlModule
  return { gl, map, source, handlers }
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
    success?.({
      coords: { latitude: 5, longitude: 6 } as GeolocationCoordinates
    })

    expect(map.easeTo).not.toHaveBeenCalled()
  })
})
