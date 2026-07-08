/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { createMapKitTestDouble } from '@/lib/components/fitness/mapkitTestDouble'
import { loadMapKitModule } from '@/lib/utils/mapkit'

import { RegionMapKit } from './RegionMapKit'

// MapKit is a browser-only CDN script that never loads in jsdom, so the loader is
// stubbed with a never-resolving promise by default — the picker must stay in its
// loading state without throwing. Tests that need the post-load behaviour resolve
// it with the in-memory MapKit test double instead.
vi.mock('@/lib/utils/mapkit', () => ({
  loadMapKitModule: vi.fn(() => new Promise(() => {}))
}))

const mockLoadMapKitModule = vi.mocked(loadMapKitModule)

const DEFAULT_BOX = {
  nw: { lat: 53, lng: 3 },
  se: { lat: 50, lng: 7 }
}

const renderRegionMapKit = (
  overrides: Partial<Parameters<typeof RegionMapKit>[0]> = {}
) => {
  const onChange = vi.fn()
  const onUnavailable = vi.fn()
  const utils = render(
    <RegionMapKit
      box={DEFAULT_BOX}
      onChange={onChange}
      centerOnUser={false}
      onUnavailable={onUnavailable}
      {...overrides}
    />
  )
  return { onChange, onUnavailable, ...utils }
}

// jsdom has no PointerEvent, and MouseEvent's pageX/pageY are read-only zeros.
const pointerEvent = (type: string, pageX: number, pageY: number) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'pageX', { value: pageX })
  Object.defineProperty(event, 'pageY', { value: pageY })
  return event
}

describe('RegionMapKit', () => {
  beforeEach(() => {
    mockLoadMapKitModule.mockReset()
    mockLoadMapKitModule.mockImplementation(
      (() => new Promise(() => {})) as never
    )
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('shows a loading state until MapKit resolves', () => {
    renderRegionMapKit()

    expect(screen.getByText(/Loading map/i)).toBeInTheDocument()
    // The draw controls and provider badge only render once the map is ready.
    expect(screen.queryByRole('button', { name: /Draw/i })).toBeNull()
    expect(screen.queryByText('Apple Maps')).not.toBeInTheDocument()
  })

  it('calls onUnavailable when the MapKit module fails to load', async () => {
    mockLoadMapKitModule.mockReturnValueOnce(
      Promise.reject(new Error('boom')) as never
    )

    const { onUnavailable } = renderRegionMapKit()

    await waitFor(() => expect(onUnavailable).toHaveBeenCalled())
  })

  it('draws the selection box from a pointer drag and restores the map gestures', async () => {
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockImplementation((() =>
      Promise.resolve(double.mapkit)) as never)

    const { onChange } = renderRegionMapKit()
    await waitFor(() => expect(double.maps).toHaveLength(1))
    const map = double.getMap()
    if (!map) throw new Error('map was never created')

    fireEvent.click(screen.getByRole('button', { name: 'Draw' }))
    onChange.mockClear()

    // The test double maps page space onto coordinates: x → longitude, y → latitude.
    map.element.dispatchEvent(pointerEvent('pointerdown', 5, 10))
    expect(onChange).toHaveBeenLastCalledWith({
      nw: { lat: 10, lng: 5 },
      se: { lat: 10, lng: 5 }
    })
    // The drag owns the pointer: MapKit's own gestures are suspended.
    expect(map.isScrollEnabled).toBe(false)
    expect(map.isZoomEnabled).toBe(false)
    expect(map.isRotationEnabled).toBe(false)

    map.element.dispatchEvent(pointerEvent('pointermove', 7, 12))
    expect(onChange).toHaveBeenLastCalledWith({
      nw: { lat: 12, lng: 5 },
      se: { lat: 10, lng: 7 }
    })

    map.element.dispatchEvent(pointerEvent('pointerup', 7, 12))
    expect(map.isScrollEnabled).toBe(true)
    expect(map.isZoomEnabled).toBe(true)
    expect(map.isRotationEnabled).toBe(true)

    // A move after the drag ended must not keep redrawing.
    onChange.mockClear()
    map.element.dispatchEvent(pointerEvent('pointermove', 20, 20))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('restores the map gestures when the pointer is released outside the map', async () => {
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockImplementation((() =>
      Promise.resolve(double.mapkit)) as never)

    renderRegionMapKit()
    await waitFor(() => expect(double.maps).toHaveLength(1))
    const map = double.getMap()
    if (!map) throw new Error('map was never created')

    fireEvent.click(screen.getByRole('button', { name: 'Draw' }))
    map.element.dispatchEvent(pointerEvent('pointerdown', 5, 10))
    expect(map.isScrollEnabled).toBe(false)

    window.dispatchEvent(pointerEvent('pointerup', 500, 500))
    expect(map.isScrollEnabled).toBe(true)
    expect(map.isZoomEnabled).toBe(true)
    expect(map.isRotationEnabled).toBe(true)
  })

  it('restores the map gestures and removes the pointer listeners on unmount', async () => {
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockImplementation((() =>
      Promise.resolve(double.mapkit)) as never)

    const { unmount } = renderRegionMapKit()
    await waitFor(() => expect(double.maps).toHaveLength(1))
    const map = double.getMap()
    if (!map) throw new Error('map was never created')

    fireEvent.click(screen.getByRole('button', { name: 'Draw' }))
    map.element.dispatchEvent(pointerEvent('pointerdown', 5, 10))
    expect(map.isScrollEnabled).toBe(false)

    const removeEventListener = vi.spyOn(map.element, 'removeEventListener')
    unmount()

    // Unmounting mid-drag still hands the map back its gestures before teardown.
    expect(map.isScrollEnabled).toBe(true)
    expect(map.isZoomEnabled).toBe(true)
    expect(map.isRotationEnabled).toBe(true)
    expect(map.destroyCount).toBe(1)
    const removedTypes = removeEventListener.mock.calls.map(
      (call: unknown[]) => call[0]
    )
    expect(removedTypes).toEqual(
      expect.arrayContaining([
        'pointerdown',
        'pointermove',
        'pointerup',
        'pointercancel'
      ])
    )
  })

  it('draws the current box as a polygon overlay once the map is ready', async () => {
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockImplementation((() =>
      Promise.resolve(double.mapkit)) as never)

    renderRegionMapKit()
    await waitFor(() =>
      expect(double.overlaysOfKind('polygon')).toHaveLength(1)
    )

    expect(double.overlaysOfKind('polygon')[0].points).toEqual([
      { latitude: 53, longitude: 3 },
      { latitude: 53, longitude: 7 },
      { latitude: 50, longitude: 7 },
      { latitude: 50, longitude: 3 }
    ])
  })
})
