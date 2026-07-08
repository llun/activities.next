/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'

import { createMapKitTestDouble } from '@/lib/components/fitness/mapkitTestDouble'
import { loadMapKitModule } from '@/lib/utils/mapkit'

import { PrivacyZoneMapKit } from './PrivacyZoneMapKit'

// MapKit is a browser-only CDN script that never loads in jsdom, so the loader is
// stubbed with a never-resolving promise by default. Tests that need the post-load
// behaviour resolve it with the in-memory MapKit test double instead.
vi.mock('@/lib/utils/mapkit', () => ({
  loadMapKitModule: vi.fn(() => new Promise(() => {}))
}))

const mockLoadMapKitModule = vi.mocked(loadMapKitModule)

describe('PrivacyZoneMapKit', () => {
  beforeEach(() => {
    mockLoadMapKitModule.mockReset()
    mockLoadMapKitModule.mockImplementation(
      (() => new Promise(() => {})) as never
    )
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('shows the loading overlay while MapKit is still loading', () => {
    render(
      <PrivacyZoneMapKit
        marker={null}
        zones={[]}
        onPick={vi.fn()}
        onUnavailable={vi.fn()}
      />
    )

    expect(screen.getByText(/Loading map/i)).toBeInTheDocument()
    expect(
      screen.getByLabelText('Privacy location picker map')
    ).toBeInTheDocument()
    expect(screen.queryByText('Apple Maps')).not.toBeInTheDocument()
  })

  it('does not report ready while MapKit is still loading', () => {
    const onReady = vi.fn()

    render(
      <PrivacyZoneMapKit
        marker={{ latitude: 52.1, longitude: 5.3 }}
        zones={[{ latitude: 52.1, longitude: 5.3, hideRadiusMeters: 500 }]}
        onPick={vi.fn()}
        onReady={onReady}
        onUnavailable={vi.fn()}
      />
    )

    expect(onReady).not.toHaveBeenCalled()
  })

  it('calls onUnavailable when the MapKit module fails to load', async () => {
    mockLoadMapKitModule.mockReturnValueOnce(
      Promise.reject(new Error('boom')) as never
    )
    const onUnavailable = vi.fn()

    render(
      <PrivacyZoneMapKit
        marker={null}
        zones={[]}
        onPick={vi.fn()}
        onUnavailable={onUnavailable}
      />
    )

    await waitFor(() => expect(onUnavailable).toHaveBeenCalled())
  })

  it('picks the tapped coordinate from a single-tap event', async () => {
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockImplementation((() =>
      Promise.resolve(double.mapkit)) as never)
    const onPick = vi.fn()
    const onReady = vi.fn()

    render(
      <PrivacyZoneMapKit
        marker={null}
        zones={[]}
        onPick={onPick}
        onReady={onReady}
        onUnavailable={vi.fn()}
      />
    )

    await waitFor(() => expect(onReady).toHaveBeenCalled())
    const map = double.getMap()
    if (!map) throw new Error('map was never created')

    // The test double maps page space onto coordinates: x → longitude, y → latitude.
    map.emit('single-tap', { pointOnPage: { x: 5.3, y: 52.1 } })

    expect(onPick).toHaveBeenCalledWith({ latitude: 52.1, longitude: 5.3 })
    expect(await screen.findByText('Apple Maps')).toBeInTheDocument()
  })

  it('draws every saved zone as a circle overlay at its hide radius', async () => {
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockImplementation((() =>
      Promise.resolve(double.mapkit)) as never)

    const { rerender } = render(
      <PrivacyZoneMapKit
        marker={null}
        zones={[
          { latitude: 52.1, longitude: 5.3, hideRadiusMeters: 500 },
          { latitude: 51, longitude: 4, hideRadiusMeters: 250 }
        ]}
        onPick={vi.fn()}
        onUnavailable={vi.fn()}
      />
    )

    await waitFor(() => expect(double.overlaysOfKind('circle')).toHaveLength(2))
    expect(
      double.overlaysOfKind('circle').map((overlay) => ({
        coordinate: overlay.points[0],
        radiusMeters: overlay.radiusMeters,
        styleOptions: overlay.styleOptions
      }))
    ).toEqual([
      {
        coordinate: { latitude: 52.1, longitude: 5.3 },
        radiusMeters: 500,
        styleOptions: {
          strokeColor: '#16a34a',
          lineWidth: 2,
          fillColor: '#16a34a',
          fillOpacity: 0.2
        }
      },
      {
        coordinate: { latitude: 51, longitude: 4 },
        radiusMeters: 250,
        styleOptions: {
          strokeColor: '#16a34a',
          lineWidth: 2,
          fillColor: '#16a34a',
          fillOpacity: 0.2
        }
      }
    ])

    // A re-render with an equal-valued zone array must not rebuild the overlays.
    rerender(
      <PrivacyZoneMapKit
        marker={null}
        zones={[
          { latitude: 52.1, longitude: 5.3, hideRadiusMeters: 500 },
          { latitude: 51, longitude: 4, hideRadiusMeters: 250 }
        ]}
        onPick={vi.fn()}
        onUnavailable={vi.fn()}
      />
    )
    expect(double.overlaysOfKind('circle')).toHaveLength(2)
    expect(double.getMap()?.removedOverlays).toHaveLength(0)
  })

  it('moves the pending marker annotation when the marker coordinate changes', async () => {
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockImplementation((() =>
      Promise.resolve(double.mapkit)) as never)

    const { rerender } = render(
      <PrivacyZoneMapKit
        marker={{ latitude: 52.1, longitude: 5.3 }}
        zones={[]}
        onPick={vi.fn()}
        onUnavailable={vi.fn()}
      />
    )

    await waitFor(() => expect(double.annotations).toHaveLength(1))
    const map = double.getMap()

    rerender(
      <PrivacyZoneMapKit
        marker={{ latitude: 40, longitude: 2 }}
        zones={[]}
        onPick={vi.fn()}
        onUnavailable={vi.fn()}
      />
    )

    await waitFor(() => expect(double.annotations).toHaveLength(2))
    expect(map?.removedAnnotations).toHaveLength(1)
    expect(map?.currentAnnotations).toHaveLength(1)
    expect(double.annotations[1].coordinate).toEqual({
      latitude: 40,
      longitude: 2
    })
    expect(double.maps).toHaveLength(1)
  })
})
