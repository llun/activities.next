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

const createFakeGl = () => {
  const handlers: Handlers = {}
  const map = {
    on: vi.fn((event: string, callback: (event?: unknown) => void) => {
      handlers[event] = callback
    }),
    remove: vi.fn(),
    resize: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    getSource: vi.fn(() => ({ setData: vi.fn() })),
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
  return { gl, map, handlers }
}

const renderRegionMap = (
  gl: GlModule,
  overrides: Partial<Parameters<typeof RegionMap>[0]> = {}
) => {
  const onChange = vi.fn()
  const onUnavailable = vi.fn()
  render(
    <RegionMap
      box={DEFAULT_BOX}
      onChange={onChange}
      loadModule={() => Promise.resolve(gl)}
      mapOptions={{ style: 'test-style' }}
      providerLabel="TestMaps"
      centerOnUser={false}
      onUnavailable={onUnavailable}
      {...overrides}
    />
  )
  return { onChange, onUnavailable }
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
})
