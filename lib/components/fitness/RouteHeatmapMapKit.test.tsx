/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import type { FitnessRouteHeatmapData } from '@/lib/client'

import { RouteHeatmapMapKit } from './RouteHeatmapMapKit'

// MapKit is a browser-only CDN script that never loads in jsdom, so the loader is
// stubbed with a never-resolving promise — the component must stay in its loading
// state without throwing. Mirrors how the GL component tests stub their loaders.
vi.mock('@/lib/utils/mapkit', () => ({
  loadMapKitModule: vi.fn(() => new Promise(() => {}))
}))

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

describe('RouteHeatmapMapKit', () => {
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
})
