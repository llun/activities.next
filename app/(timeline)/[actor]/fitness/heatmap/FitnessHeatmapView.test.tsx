/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, render, screen, waitFor } from '@testing-library/react'

import {
  getDistinctFitnessActivityTypes,
  getFitnessCalendarData,
  getFitnessRouteHeatmap,
  getFitnessRouteHeatmaps,
  triggerFitnessRouteHeatmap
} from '@/lib/client'
import type {
  FitnessRouteHeatmapData,
  FitnessRouteHeatmapSummaryData
} from '@/lib/client'
import { loadMapboxModule } from '@/lib/utils/mapbox'

import { FitnessHeatmapView, RouteHeatmapMap } from './FitnessHeatmapView'

jest.mock('@/lib/utils/mapbox', () => ({
  loadMapboxModule: jest.fn()
}))

jest.mock('@/lib/client', () => ({
  getDistinctFitnessActivityTypes: jest.fn(),
  getFitnessCalendarData: jest.fn(),
  getFitnessRouteHeatmap: jest.fn(),
  getFitnessRouteHeatmaps: jest.fn(),
  triggerFitnessRouteHeatmap: jest.fn()
}))

const mockLoadMapboxModule = loadMapboxModule as jest.MockedFunction<
  typeof loadMapboxModule
>
const mockGetDistinctFitnessActivityTypes =
  getDistinctFitnessActivityTypes as jest.MockedFunction<
    typeof getDistinctFitnessActivityTypes
  >
const mockGetFitnessCalendarData =
  getFitnessCalendarData as jest.MockedFunction<typeof getFitnessCalendarData>
const mockGetFitnessRouteHeatmap =
  getFitnessRouteHeatmap as jest.MockedFunction<typeof getFitnessRouteHeatmap>
const mockGetFitnessRouteHeatmaps =
  getFitnessRouteHeatmaps as jest.MockedFunction<typeof getFitnessRouteHeatmaps>
const mockTriggerFitnessRouteHeatmap =
  triggerFitnessRouteHeatmap as jest.MockedFunction<
    typeof triggerFitnessRouteHeatmap
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

const pendingSummary: FitnessRouteHeatmapSummaryData = {
  id: 'route-heatmap-background',
  periodType: 'yearly',
  periodKey: '2026',
  region: '',
  status: 'generating',
  activityCount: 1,
  pointCount: 2,
  cursorOffset: 10,
  isPartial: false,
  createdAt: 1,
  updatedAt: 2
}

describe('FitnessHeatmapView', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetDistinctFitnessActivityTypes.mockResolvedValue([])
    mockGetFitnessCalendarData.mockResolvedValue([])
    mockGetFitnessRouteHeatmap.mockResolvedValue(completedHeatmap)
    mockGetFitnessRouteHeatmaps.mockResolvedValue([pendingSummary])
    mockTriggerFitnessRouteHeatmap.mockResolvedValue(true)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('keeps polling history entries without stalling a completed selection', async () => {
    jest.useFakeTimers()

    render(<FitnessHeatmapView actorId="https://llun.test/users/llun" />)

    await waitFor(() => {
      expect(mockGetFitnessRouteHeatmap).toHaveBeenCalledTimes(1)
      expect(mockGetFitnessRouteHeatmaps).toHaveBeenCalledTimes(1)
    })

    mockGetFitnessRouteHeatmap.mockClear()

    const callsAfterInitialLoad = mockGetFitnessRouteHeatmaps.mock.calls.length

    for (let i = 0; i < 35; i++) {
      await act(async () => {
        jest.advanceTimersByTime(5000)
        await Promise.resolve()
      })
    }
    const callsAfterStallWindow = mockGetFitnessRouteHeatmaps.mock.calls.length

    await act(async () => {
      jest.advanceTimersByTime(5000)
      await Promise.resolve()
    })

    expect(callsAfterStallWindow).toBeGreaterThan(callsAfterInitialLoad)
    expect(mockGetFitnessRouteHeatmaps.mock.calls.length).toBeGreaterThan(
      callsAfterStallWindow
    )
    expect(mockGetFitnessRouteHeatmap).not.toHaveBeenCalled()
    expect(
      screen.queryByText('Route cache is taking longer than expected')
    ).not.toBeInTheDocument()
  })
})

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
