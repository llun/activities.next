/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'

import type { FitnessRouteHeatmapData } from '@/lib/client'
import { createMapKitTestDouble } from '@/lib/components/fitness/mapkitTestDouble'
import { loadMapKitModule } from '@/lib/utils/mapkit'

import { RouteHeatmapMapKit } from './RouteHeatmapMapKit'

// MapKit is a browser-only CDN script that never loads in jsdom, so the loader is
// stubbed with a never-resolving promise by default. Tests that need the post-load
// behaviour resolve it with the in-memory MapKit test double instead.
vi.mock('@/lib/utils/mapkit', () => ({
  loadMapKitModule: vi.fn(() => new Promise(() => {}))
}))

const mockLoadMapKitModule = vi.mocked(loadMapKitModule)

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

const VISIBLE_STYLE = {
  strokeColor: '#ef4444',
  lineWidth: 2.8,
  strokeOpacity: 0.55
}
const HIDDEN_STYLE = {
  strokeColor: '#2563eb',
  lineWidth: 2.2,
  strokeOpacity: 0.4
}

describe('RouteHeatmapMapKit', () => {
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
    render(<RouteHeatmapMapKit heatmap={heatmap} />)

    expect(screen.getByText(/Loading map/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Fitness route heatmap')).toBeInTheDocument()
    // The provider badge only appears once MapKit finishes loading.
    expect(screen.queryByText('Apple Maps')).not.toBeInTheDocument()
  })

  it('renders the empty state when the heatmap has no drawable routes', () => {
    render(<RouteHeatmapMapKit heatmap={null} />)

    expect(
      screen.getByText('No route data for this selection')
    ).toBeInTheDocument()
  })

  it('applies the caller-supplied height class to the map surface', () => {
    const { container } = render(
      <RouteHeatmapMapKit heatmap={heatmap} heightClassName="h-dvh" />
    )

    expect(container.firstElementChild).toHaveClass('h-dvh')
  })

  it('builds one styled polyline overlay per segment once MapKit resolves', async () => {
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockImplementation((() =>
      Promise.resolve(double.mapkit)) as never)

    render(
      <RouteHeatmapMapKit
        heatmap={{
          ...heatmap,
          segments: [
            heatmap.segments[0],
            { ...heatmap.segments[0], isHiddenByPrivacy: true }
          ]
        }}
      />
    )

    await waitFor(() =>
      expect(double.getMap()?.currentOverlays).toHaveLength(2)
    )
    expect(
      double.overlaysOfKind('polyline').map((overlay) => overlay.styleOptions)
    ).toEqual([VISIBLE_STYLE, HIDDEN_STYLE])
    expect(await screen.findByText('Apple Maps')).toBeInTheDocument()
  })

  it('refreshes the overlays when the cached route geometry changes in place', async () => {
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockImplementation((() =>
      Promise.resolve(double.mapkit)) as never)

    const { rerender } = render(<RouteHeatmapMapKit heatmap={heatmap} />)
    await waitFor(() =>
      expect(double.getMap()?.currentOverlays).toHaveLength(1)
    )

    // Same heatmap id and bounds, new geometry — the GL sibling repaints this via
    // `source.setData`, so MapKit must rebuild its overlays rather than go stale.
    rerender(
      <RouteHeatmapMapKit
        heatmap={{
          ...heatmap,
          updatedAt: 3,
          segments: [
            heatmap.segments[0],
            {
              isHiddenByPrivacy: true,
              points: [
                { lat: 52.1, lng: 5.7 },
                { lat: 52.5, lng: 6.1 }
              ]
            }
          ]
        }}
      />
    )

    await waitFor(() =>
      expect(double.getMap()?.currentOverlays).toHaveLength(2)
    )
    expect(double.getMap()?.removedOverlays).toHaveLength(1)
    expect(double.overlaysOfKind('polyline')).toHaveLength(3)
    // The map itself is reused, only the overlays are rebuilt.
    expect(double.maps).toHaveLength(1)
    expect(double.getMap()?.destroyCount).toBe(0)
  })
})
