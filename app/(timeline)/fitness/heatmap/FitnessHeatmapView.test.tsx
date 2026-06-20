/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'

import {
  clearFitnessRouteHeatmaps,
  getDistinctFitnessActivityTypes,
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

vi.mock('@/lib/utils/mapbox', () => ({
  loadMapboxModule: vi.fn()
}))

vi.mock('@/lib/client', () => ({
  clearFitnessRouteHeatmaps: vi.fn(),
  getDistinctFitnessActivityTypes: vi.fn(),
  getFitnessRouteHeatmap: vi.fn(),
  getFitnessRouteHeatmaps: vi.fn(),
  triggerFitnessRouteHeatmap: vi.fn()
}))

const mockLoadMapboxModule = loadMapboxModule as jest.MockedFunction<
  typeof loadMapboxModule
>
const mockClearFitnessRouteHeatmaps =
  clearFitnessRouteHeatmaps as jest.MockedFunction<
    typeof clearFitnessRouteHeatmaps
  >
const mockGetDistinctFitnessActivityTypes =
  getDistinctFitnessActivityTypes as jest.MockedFunction<
    typeof getDistinctFitnessActivityTypes
  >
const mockGetFitnessRouteHeatmap =
  getFitnessRouteHeatmap as jest.MockedFunction<typeof getFitnessRouteHeatmap>
const mockGetFitnessRouteHeatmaps =
  getFitnessRouteHeatmaps as jest.MockedFunction<typeof getFitnessRouteHeatmaps>
const mockTriggerFitnessRouteHeatmap =
  triggerFitnessRouteHeatmap as jest.MockedFunction<
    typeof triggerFitnessRouteHeatmap
  >

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

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

const completedSummary: FitnessRouteHeatmapSummaryData = {
  ...pendingSummary,
  id: 'route-heatmap-completed',
  status: 'completed',
  cursorOffset: 0
}

const TEST_NOW = 1_700_000_060_000
const IN_FLIGHT_HISTORY_POLL_WINDOW_MS = 15 * 60_000

const pendingSummaryAtAge = (
  ageMs: number
): FitnessRouteHeatmapSummaryData => ({
  ...pendingSummary,
  updatedAt: TEST_NOW - ageMs
})

const buildLargeHeatmap = (): FitnessRouteHeatmapData => {
  const segmentCount = 80
  const pointsPerSegment = 1000
  const segments: FitnessRouteHeatmapData['segments'] = Array.from(
    { length: segmentCount },
    (_, segmentIndex) => ({
      points: Array.from({ length: pointsPerSegment }, (_point, pointIndex) => {
        const progress =
          (segmentIndex * pointsPerSegment + pointIndex) /
          (segmentCount * pointsPerSegment - 1)
        const branchOffset = (segmentIndex % 8) * 0.0008

        return {
          lat: 52.36 + progress * 0.03 + Math.sin(pointIndex / 30) * 0.0002,
          lng: 4.88 + branchOffset + progress * 0.03
        }
      })
    })
  )

  return {
    ...completedHeatmap,
    id: 'route-heatmap-large',
    bounds: {
      minLat: 52.36,
      maxLat: 52.39,
      minLng: 4.88,
      maxLng: 4.916
    },
    segments,
    activityCount: segmentCount,
    pointCount: segmentCount * pointsPerSegment,
    updatedAt: 3
  }
}

describe('FitnessHeatmapView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetDistinctFitnessActivityTypes.mockResolvedValue([])
    mockGetFitnessRouteHeatmap.mockResolvedValue(completedHeatmap)
    mockGetFitnessRouteHeatmaps.mockResolvedValue([pendingSummary])
    mockClearFitnessRouteHeatmaps.mockResolvedValue(0)
    mockTriggerFitnessRouteHeatmap.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps polling fresh history entries without stalling a completed selection', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(TEST_NOW)
    mockGetFitnessRouteHeatmaps.mockResolvedValue([
      pendingSummaryAtAge(IN_FLIGHT_HISTORY_POLL_WINDOW_MS)
    ])

    render(<FitnessHeatmapView actorId="https://llun.test/users/llun" />)

    await waitFor(() => {
      expect(mockGetFitnessRouteHeatmap).toHaveBeenCalledTimes(1)
      expect(mockGetFitnessRouteHeatmaps).toHaveBeenCalledTimes(1)
      expect(screen.getByText('Generating…')).toBeInTheDocument()
    })

    mockGetFitnessRouteHeatmap.mockClear()

    const callsAfterInitialLoad = mockGetFitnessRouteHeatmaps.mock.calls.length

    for (let i = 0; i < 2; i++) {
      await act(async () => {
        vi.advanceTimersByTime(5000)
        await Promise.resolve()
      })
    }

    expect(mockGetFitnessRouteHeatmaps.mock.calls.length).toBeGreaterThan(
      callsAfterInitialLoad
    )
    expect(mockGetFitnessRouteHeatmap).not.toHaveBeenCalled()
    expect(
      screen.queryByText('Route cache is taking longer than expected')
    ).not.toBeInTheDocument()
  })

  it('does not keep polling stale in-progress history entries', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(TEST_NOW)
    mockGetFitnessRouteHeatmaps.mockResolvedValue([
      pendingSummaryAtAge(IN_FLIGHT_HISTORY_POLL_WINDOW_MS + 1)
    ])

    render(<FitnessHeatmapView actorId="https://llun.test/users/llun" />)

    await waitFor(() => {
      expect(mockGetFitnessRouteHeatmap).toHaveBeenCalledTimes(1)
      expect(mockGetFitnessRouteHeatmaps).toHaveBeenCalledTimes(1)
    })

    const callsAfterInitialLoad = mockGetFitnessRouteHeatmaps.mock.calls.length

    await act(async () => {
      vi.advanceTimersByTime(15_000)
      await Promise.resolve()
    })

    expect(mockGetFitnessRouteHeatmaps).toHaveBeenCalledTimes(
      callsAfterInitialLoad
    )
  })

  it('ignores stale selection responses before mutating state or enqueueing', async () => {
    const staleHeatmap = createDeferred<FitnessRouteHeatmapData | null>()
    mockGetFitnessRouteHeatmap.mockReset()
    mockGetFitnessRouteHeatmap
      .mockReturnValueOnce(staleHeatmap.promise)
      .mockResolvedValue(completedHeatmap)

    const { rerender } = render(
      <FitnessHeatmapView actorId="https://llun.test/users/first" />
    )
    rerender(<FitnessHeatmapView actorId="https://llun.test/users/second" />)

    await waitFor(() => {
      expect(screen.getByText('Routes')).toBeInTheDocument()
    })

    await act(async () => {
      staleHeatmap.resolve(null)
      await Promise.resolve()
    })

    expect(mockTriggerFitnessRouteHeatmap).not.toHaveBeenCalled()
    expect(screen.getByText('Routes')).toBeInTheDocument()
  })

  it('keeps completed refreshes on the normal deduplicated enqueue path', async () => {
    render(<FitnessHeatmapView actorId="https://llun.test/users/llun" />)

    await waitFor(() => {
      expect(screen.getByText('Routes')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Generate heatmap/i }))

    await waitFor(() => {
      expect(mockTriggerFitnessRouteHeatmap).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'https://llun.test/users/llun',
          periodType: 'yearly',
          periodKey: '2026',
          retry: false
        })
      )
    })
  })

  it('allows manual generation retry for a missing selection when other route caches exist', async () => {
    mockGetFitnessRouteHeatmap.mockResolvedValue(null)
    mockGetFitnessRouteHeatmaps.mockResolvedValue([completedSummary])
    mockTriggerFitnessRouteHeatmap
      .mockRejectedValueOnce(new Error('queue unavailable'))
      .mockResolvedValueOnce(true)

    render(<FitnessHeatmapView actorId="https://llun.test/users/llun" />)

    expect(await screen.findByText('queue unavailable')).toBeInTheDocument()

    const generateButton = screen.getByRole('button', { name: /Generate/i })
    fireEvent.click(generateButton)

    await waitFor(() => {
      expect(mockTriggerFitnessRouteHeatmap).toHaveBeenCalledTimes(2)
      expect(mockTriggerFitnessRouteHeatmap).toHaveBeenLastCalledWith(
        expect.objectContaining({
          actorId: 'https://llun.test/users/llun',
          periodType: 'all_time',
          periodKey: 'all'
        })
      )
    })
    await waitFor(() => {
      expect(screen.queryByText('queue unavailable')).not.toBeInTheDocument()
    })
  })

  it('keeps the route map in a full-width region outside the route cache panel', async () => {
    render(<FitnessHeatmapView actorId="https://llun.test/users/llun" />)

    const routeMapRegion = await screen.findByRole('region', {
      name: 'Route heatmap map'
    })
    const heatmapsHeading = screen.getByRole('heading', {
      name: 'Heatmaps'
    })

    expect(routeMapRegion).not.toContainElement(heatmapsHeading)
    // The job-list panel should follow the full-width map region instead of
    // being nested beside it in the same grid row.
    expect(
      routeMapRegion.compareDocumentPosition(heatmapsHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('clears all route caches without immediately requeueing the current selection', async () => {
    mockClearFitnessRouteHeatmaps.mockResolvedValue(2)
    mockGetFitnessRouteHeatmap
      .mockResolvedValueOnce(completedHeatmap)
      .mockResolvedValueOnce(null)
    mockGetFitnessRouteHeatmaps
      .mockResolvedValueOnce([pendingSummary])
      .mockResolvedValueOnce([])

    render(<FitnessHeatmapView actorId="https://llun.test/users/llun" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Clear cache/i })).toBeEnabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /Clear cache/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Clear route caches/i }))

    await waitFor(() => {
      expect(mockClearFitnessRouteHeatmaps).toHaveBeenCalledWith({
        actorId: 'https://llun.test/users/llun'
      })
      expect(mockGetFitnessRouteHeatmap).toHaveBeenCalledTimes(2)
      expect(mockGetFitnessRouteHeatmaps).toHaveBeenCalledTimes(2)
      expect(mockTriggerFitnessRouteHeatmap).not.toHaveBeenCalled()
    })

    const generateButton = await screen.findByRole('button', {
      name: /Generate/i
    })
    fireEvent.click(generateButton)

    await waitFor(() => {
      expect(mockTriggerFitnessRouteHeatmap).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'https://llun.test/users/llun',
          periodType: 'all_time',
          periodKey: 'all'
        })
      )
    })
  })

  it('does not clear route caches when confirmation is cancelled', async () => {
    render(<FitnessHeatmapView actorId="https://llun.test/users/llun" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Clear cache/i })).toBeEnabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /Clear cache/i }))
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))

    expect(mockClearFitnessRouteHeatmaps).not.toHaveBeenCalled()
  })

  it('keeps page errors when the clear route cache dialog is opened and cancelled', async () => {
    mockTriggerFitnessRouteHeatmap.mockRejectedValueOnce(
      new Error('refresh broken')
    )

    render(<FitnessHeatmapView actorId="https://llun.test/users/llun" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Clear cache/i })).toBeEnabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /Generate heatmap/i }))

    expect(await screen.findByText('refresh broken')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Clear cache/i }))
    const dialog = screen.getByRole('dialog')

    expect(screen.getByText('refresh broken')).toBeInTheDocument()
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: /Cancel/i }))

    expect(screen.getByText('refresh broken')).toBeInTheDocument()
    expect(mockClearFitnessRouteHeatmaps).not.toHaveBeenCalled()
  })

  it('surfaces an error when clearing route caches fails', async () => {
    mockClearFitnessRouteHeatmaps.mockRejectedValue(new Error('boom'))

    render(<FitnessHeatmapView actorId="https://llun.test/users/llun" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Clear cache/i })).toBeEnabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /Clear cache/i }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: /Clear route caches/i })
    )

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('boom')
    expect(mockClearFitnessRouteHeatmaps).toHaveBeenCalledWith({
      actorId: 'https://llun.test/users/llun'
    })
    expect(mockTriggerFitnessRouteHeatmap).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: /Cancel/i }))
    expect(screen.queryByText('boom')).not.toBeInTheDocument()
  })
})

describe('RouteHeatmapMap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    const mapConstructor = vi.fn().mockImplementation(function () {
      return {
        on: (_event: string, callback: () => void) => callback(),
        remove: vi.fn(),
        resize: vi.fn(),
        addSource: vi.fn(),
        addLayer: vi.fn(),
        getSource: vi.fn(),
        fitBounds: vi.fn()
      }
    })
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

  it('falls back with a diagnostic reason when Mapbox setup fails', async () => {
    const mapConstructor = vi.fn().mockImplementation(function () {
      return {
        on: (_event: string, callback: () => void) => callback(),
        remove: vi.fn(),
        resize: vi.fn(),
        addSource: vi.fn(() => {
          throw new Error('source unavailable')
        }),
        addLayer: vi.fn(),
        getSource: vi.fn(),
        fitBounds: vi.fn()
      }
    })
    mockLoadMapboxModule.mockResolvedValue({
      Map: mapConstructor
    })

    const { container } = render(
      <RouteHeatmapMap
        heatmap={completedHeatmap}
        mapboxAccessToken="mapbox-token"
      />
    )

    await waitFor(() => expect(screen.getByText('Routes')).toBeInTheDocument())
    expect(screen.queryByText('Mapbox')).not.toBeInTheDocument()
    expect(
      container.querySelector('[data-mapbox-fallback-reason="render-failed"]')
    ).toBeInTheDocument()
    expect(
      container.querySelector(
        '[data-mapbox-fallback-error="source unavailable"]'
      )
    ).toBeInTheDocument()
  })

  it('falls back with a diagnostic reason when Mapbox fails to load', async () => {
    mockLoadMapboxModule.mockRejectedValue(new Error('module unavailable'))

    const { container } = render(
      <RouteHeatmapMap
        heatmap={completedHeatmap}
        mapboxAccessToken="mapbox-token"
      />
    )

    await waitFor(() => expect(screen.getByText('Routes')).toBeInTheDocument())
    expect(screen.queryByText('Mapbox')).not.toBeInTheDocument()
    expect(
      container.querySelector(
        '[data-mapbox-fallback-reason="module-load-failed"]'
      )
    ).toBeInTheDocument()
    expect(
      container.querySelector(
        '[data-mapbox-fallback-error="module unavailable"]'
      )
    ).toBeInTheDocument()
  })

  it('retries Mapbox when the same route cache is regenerated', async () => {
    const failingMapConstructor = vi.fn().mockImplementation(function () {
      return {
        on: (_event: string, callback: () => void) => callback(),
        remove: vi.fn(),
        resize: vi.fn(),
        addSource: vi.fn(() => {
          throw new Error('source unavailable')
        }),
        addLayer: vi.fn(),
        getSource: vi.fn(),
        fitBounds: vi.fn()
      }
    })
    mockLoadMapboxModule.mockResolvedValue({
      Map: failingMapConstructor
    })

    const { container, rerender } = render(
      <RouteHeatmapMap
        heatmap={completedHeatmap}
        mapboxAccessToken="mapbox-token"
      />
    )

    await waitFor(() =>
      expect(
        container.querySelector('[data-mapbox-fallback-reason="render-failed"]')
      ).toBeInTheDocument()
    )

    const workingMapConstructor = vi.fn().mockImplementation(function () {
      return {
        on: (_event: string, callback: () => void) => callback(),
        remove: vi.fn(),
        resize: vi.fn(),
        addSource: vi.fn(),
        addLayer: vi.fn(),
        getSource: vi.fn(),
        fitBounds: vi.fn()
      }
    })
    mockLoadMapboxModule.mockResolvedValue({
      Map: workingMapConstructor
    })

    rerender(
      <RouteHeatmapMap
        heatmap={{
          ...completedHeatmap,
          updatedAt: completedHeatmap.updatedAt + 1
        }}
        mapboxAccessToken="mapbox-token"
      />
    )

    await waitFor(() => expect(screen.getByText('Mapbox')).toBeInTheDocument())
    await waitFor(() => expect(workingMapConstructor).toHaveBeenCalled())
    expect(
      container.querySelector('[data-mapbox-fallback-reason]')
    ).not.toBeInTheDocument()
  })

  it('uses the SVG route fallback for large route caches', () => {
    const largeHeatmap = buildLargeHeatmap()

    const { container } = render(
      <RouteHeatmapMap
        heatmap={largeHeatmap}
        mapboxAccessToken="mapbox-token"
      />
    )

    expect(screen.getByText('Routes')).toBeInTheDocument()
    expect(
      screen.getByText('Interactive map unavailable. Showing routes.')
    ).toBeInTheDocument()
    expect(screen.queryByText('Mapbox')).not.toBeInTheDocument()
    const polylines = Array.from(container.querySelectorAll('polyline'))
    expect(polylines).toHaveLength(largeHeatmap.segments.length)
    expect(
      polylines.map(
        (polyline) =>
          polyline.getAttribute('points')?.trim().split(/\s+/).filter(Boolean)
            .length ?? 0
      )
    ).toEqual(largeHeatmap.segments.map((segment) => segment.points.length))
    expect(
      container.querySelector(
        '[data-mapbox-fallback-reason="route-cache-too-large"]'
      )
    ).toBeInTheDocument()
    expect(
      container.querySelector('[data-mapbox-fallback-error]')
    ).not.toBeInTheDocument()
    expect(mockLoadMapboxModule).not.toHaveBeenCalled()
  })
})
