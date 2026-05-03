/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'

import { FitnessRouteHeatmapData } from '@/lib/client'
import { loadMapboxModule } from '@/lib/utils/mapbox'

import { RouteHeatmapMap } from './FitnessHeatmapView'

jest.mock('@/lib/utils/mapbox', () => ({
  loadMapboxModule: jest.fn()
}))

const mockLoadMapboxModule = loadMapboxModule as jest.MockedFunction<
  typeof loadMapboxModule
>

const completedHeatmap: FitnessRouteHeatmapData = {
  id: 'route-heatmap-1',
  periodType: 'yearly',
  periodKey: '2026',
  region: '',
  status: 'completed',
  bounds: {
    minLat: 52.36,
    maxLat: 52.39,
    minLng: 4.88,
    maxLng: 4.91
  },
  segments: [
    {
      points: [
        { lat: 52.36, lng: 4.88 },
        { lat: 52.39, lng: 4.91 }
      ]
    }
  ],
  activityCount: 1,
  pointCount: 2,
  cursorOffset: 0,
  isPartial: false,
  createdAt: 1,
  updatedAt: 2
}

describe('RouteHeatmapMap', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the SVG route fallback when Mapbox is not configured', () => {
    const { container } = render(<RouteHeatmapMap heatmap={completedHeatmap} />)

    expect(screen.getByText('Routes')).toBeInTheDocument()
    expect(container.querySelector('polyline')).toBeInTheDocument()
  })

  it('renders an empty route state', () => {
    render(
      <RouteHeatmapMap
        heatmap={{
          ...completedHeatmap,
          segments: [],
          pointCount: 0,
          bounds: null
        }}
      />
    )

    expect(
      screen.getByText('No route data for this selection')
    ).toBeInTheDocument()
  })

  it('uses Mapbox when a token is configured', async () => {
    const mapConstructor = jest.fn().mockImplementation(() => ({
      on: (_event: string, callback: () => void) => callback(),
      remove: jest.fn(),
      resize: jest.fn(),
      addSource: jest.fn(),
      addLayer: jest.fn(),
      getSource: jest.fn(),
      fitBounds: jest.fn()
    }))
    mockLoadMapboxModule.mockResolvedValue({
      Map: mapConstructor
    })

    render(
      <RouteHeatmapMap
        heatmap={completedHeatmap}
        mapboxAccessToken="mapbox-token"
      />
    )

    expect(screen.getByText('Mapbox')).toBeInTheDocument()
    await waitFor(() => expect(mapConstructor).toHaveBeenCalled())
    expect(mapConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'mapbox-token',
        attributionControl: true
      })
    )
  })
})
