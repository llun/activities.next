/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'

import type { FitnessRouteSegment } from '@/lib/client'
import { createMapKitTestDouble } from '@/lib/components/fitness/mapkitTestDouble'
import { loadMapKitModule } from '@/lib/utils/mapkit'

import { ActivityRouteMapKit } from './ActivityRouteMapKit'

// MapKit is a browser-only CDN script that never loads in jsdom, so the loader is
// stubbed with a never-resolving promise by default. Tests that need the post-load
// behaviour resolve it with the in-memory MapKit test double instead.
vi.mock('@/lib/utils/mapkit', () => ({
  loadMapKitModule: vi.fn(() => new Promise(() => {}))
}))

const mockLoadMapKitModule = vi.mocked(loadMapKitModule)

const routeSamples = [
  { lat: 52, lng: 5.6, elapsedSeconds: 0 },
  { lat: 52.6, lng: 6.2, elapsedSeconds: 120 }
]
const routeSegments: FitnessRouteSegment[] = [
  { isHiddenByPrivacy: false, samples: routeSamples }
]

// Fresh array/object identities on every render — exactly what a parent hands the
// component while the user hovers the elapsed-time chart.
const freshSegments = (): FitnessRouteSegment[] => [
  { isHiddenByPrivacy: false, samples: routeSamples.map((s) => ({ ...s })) }
]

describe('ActivityRouteMapKit', () => {
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
      <ActivityRouteMapKit
        routeSegments={routeSegments}
        routeSamples={routeSamples}
        onUnavailable={vi.fn()}
      />
    )

    expect(screen.getByText(/Loading map/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Activity route map')).toBeInTheDocument()
    // Zoom controls and the badge only render once MapKit is ready.
    expect(screen.queryByRole('button', { name: /Zoom in map/i })).toBeNull()
  })

  it('calls onUnavailable when the MapKit module fails to load', async () => {
    mockLoadMapKitModule.mockReturnValueOnce(
      Promise.reject(new Error('boom')) as never
    )
    const onUnavailable = vi.fn()

    render(
      <ActivityRouteMapKit
        routeSegments={routeSegments}
        routeSamples={routeSamples}
        highlightedElapsedSeconds={60}
        onUnavailable={onUnavailable}
      />
    )

    await waitFor(() => expect(onUnavailable).toHaveBeenCalled())
  })

  it('does not load MapKit when there is no drawable route', () => {
    render(
      <ActivityRouteMapKit
        routeSegments={[]}
        routeSamples={[]}
        onUnavailable={vi.fn()}
      />
    )

    expect(mockLoadMapKitModule).not.toHaveBeenCalled()
  })

  it('draws one polyline overlay per drawable segment once MapKit resolves', async () => {
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockImplementation((() =>
      Promise.resolve(double.mapkit)) as never)

    render(
      <ActivityRouteMapKit
        routeSegments={[
          { isHiddenByPrivacy: false, samples: routeSamples },
          { isHiddenByPrivacy: true, samples: routeSamples }
        ]}
        routeSamples={routeSamples}
        onUnavailable={vi.fn()}
      />
    )

    await waitFor(() =>
      expect(double.getMap()?.currentOverlays).toHaveLength(2)
    )
    expect(
      double.overlaysOfKind('polyline').map((overlay) => overlay.styleOptions)
    ).toEqual([
      { strokeColor: '#f97316', lineWidth: 4, strokeOpacity: 0.9 },
      { strokeColor: '#16a34a', lineWidth: 4, strokeOpacity: 0.95 }
    ])
    expect(double.getMap()?.assignedRegions).toHaveLength(1)
  })

  it('does not rebuild the map when only the highlighted elapsed time changes', async () => {
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockImplementation((() =>
      Promise.resolve(double.mapkit)) as never)

    const { rerender } = render(
      <ActivityRouteMapKit
        routeSegments={freshSegments()}
        routeSamples={routeSamples.map((sample) => ({ ...sample }))}
        highlightedElapsedSeconds={null}
        onUnavailable={vi.fn()}
      />
    )

    await waitFor(() => expect(double.maps).toHaveLength(1))
    const map = double.getMap()
    await waitFor(() => expect(map?.currentOverlays).toHaveLength(1))

    rerender(
      <ActivityRouteMapKit
        routeSegments={freshSegments()}
        routeSamples={routeSamples.map((sample) => ({ ...sample }))}
        highlightedElapsedSeconds={120}
        onUnavailable={vi.fn()}
      />
    )

    // The highlight marker follows the hover…
    await waitFor(() => expect(map?.currentAnnotations).toHaveLength(1))
    expect(double.annotations[0].coordinate).toEqual({
      latitude: 52.6,
      longitude: 6.2
    })
    // …without tearing the map (or its overlays) down and rebuilding them.
    expect(double.maps).toHaveLength(1)
    expect(map?.destroyCount).toBe(0)
    expect(map?.currentOverlays).toHaveLength(1)
    expect(map?.removedOverlays).toHaveLength(0)
    expect(mockLoadMapKitModule).toHaveBeenCalledTimes(1)
  })

  it('rebuilds the route overlays when the route data changes', async () => {
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockImplementation((() =>
      Promise.resolve(double.mapkit)) as never)

    const { rerender } = render(
      <ActivityRouteMapKit
        routeSegments={routeSegments}
        routeSamples={routeSamples}
        onUnavailable={vi.fn()}
      />
    )
    await waitFor(() =>
      expect(double.getMap()?.currentOverlays).toHaveLength(1)
    )

    const nextSamples = [
      { lat: 40, lng: 1, elapsedSeconds: 0 },
      { lat: 41, lng: 2, elapsedSeconds: 10 },
      { lat: 42, lng: 3, elapsedSeconds: 20 }
    ]
    rerender(
      <ActivityRouteMapKit
        routeSegments={[{ isHiddenByPrivacy: false, samples: nextSamples }]}
        routeSamples={nextSamples}
        onUnavailable={vi.fn()}
      />
    )

    await waitFor(() =>
      expect(double.getMap()?.removedOverlays).toHaveLength(1)
    )
    expect(double.getMap()?.currentOverlays).toHaveLength(1)
    expect(double.overlaysOfKind('polyline')).toHaveLength(2)
    expect(double.maps).toHaveLength(1)
  })
})
