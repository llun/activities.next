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
  deleteFitnessRouteHeatmap,
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
import { loadMaplibreModule } from '@/lib/utils/maplibre'

import {
  FitnessHeatmapView,
  RouteHeatmapMap,
  downsampleSegments
} from './FitnessHeatmapView'

vi.mock('@/lib/utils/mapbox', () => ({
  loadMapboxModule: vi.fn()
}))

vi.mock('@/lib/utils/maplibre', () => ({
  OPENFREEMAP_STYLE_URL: 'https://tiles.openfreemap.org/styles/bright',
  loadMaplibreModule: vi.fn()
}))

vi.mock('@/lib/client', () => ({
  clearFitnessRouteHeatmaps: vi.fn(),
  deleteFitnessRouteHeatmap: vi.fn(),
  getDistinctFitnessActivityTypes: vi.fn(),
  getFitnessRouteHeatmap: vi.fn(),
  getFitnessRouteHeatmaps: vi.fn(),
  triggerFitnessRouteHeatmap: vi.fn()
}))

const mockLoadMapboxModule = loadMapboxModule as jest.MockedFunction<
  typeof loadMapboxModule
>
const mockLoadMaplibreModule = loadMaplibreModule as jest.MockedFunction<
  typeof loadMaplibreModule
>
const mockClearFitnessRouteHeatmaps =
  clearFitnessRouteHeatmaps as jest.MockedFunction<
    typeof clearFitnessRouteHeatmaps
  >
const mockDeleteFitnessRouteHeatmap =
  deleteFitnessRouteHeatmap as jest.MockedFunction<
    typeof deleteFitnessRouteHeatmap
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

// A minimal GL map double whose `load` handler fires synchronously, so the map
// reaches its ready state within the test. `onAddSource` lets a test capture the
// GeoJSON handed to the route layer (or throw to exercise the render fallback).
const createGlMapConstructor = (
  onAddSource: (id: string, source: unknown) => void = () => {}
) =>
  vi.fn().mockImplementation(function () {
    return {
      on: (_event: string, callback: () => void) => callback(),
      remove: vi.fn(),
      resize: vi.fn(),
      addSource: vi.fn(onAddSource),
      addLayer: vi.fn(),
      getSource: vi.fn(),
      fitBounds: vi.fn()
    }
  })

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
  totalCount: 1,
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
  totalCount: 20,
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
    mockDeleteFitnessRouteHeatmap.mockResolvedValue(true)
    mockTriggerFitnessRouteHeatmap.mockResolvedValue(true)
    // No Mapbox token in these tests, so the view uses the keyless MapLibre map.
    mockLoadMaplibreModule.mockResolvedValue({ Map: createGlMapConstructor() })
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
      expect(screen.getByText('OpenFreeMap')).toBeInTheDocument()
    })

    await act(async () => {
      staleHeatmap.resolve(null)
      await Promise.resolve()
    })

    expect(mockTriggerFitnessRouteHeatmap).not.toHaveBeenCalled()
    expect(screen.getByText('OpenFreeMap')).toBeInTheDocument()
  })

  it('keeps completed refreshes on the normal deduplicated enqueue path', async () => {
    render(<FitnessHeatmapView actorId="https://llun.test/users/llun" />)

    await waitFor(() => {
      expect(screen.getByText('OpenFreeMap')).toBeInTheDocument()
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

  it('removes the focused heatmap without requeueing it afterward', async () => {
    const failedFocused: FitnessRouteHeatmapData = {
      ...completedHeatmap,
      status: 'failed',
      error: 'parse failed'
    }
    const failedSummary: FitnessRouteHeatmapSummaryData = {
      ...completedSummary,
      id: completedHeatmap.id,
      status: 'failed',
      error: 'parse failed'
    }
    mockGetFitnessRouteHeatmap.mockResolvedValue(failedFocused)
    mockGetFitnessRouteHeatmaps
      .mockResolvedValueOnce([failedSummary])
      .mockResolvedValue([])

    render(<FitnessHeatmapView actorId="https://llun.test/users/llun" />)

    const removeButton = await screen.findByRole('button', { name: 'Remove' })
    fireEvent.click(removeButton)

    const dialog = screen.getByRole('dialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: /Remove heatmap/i })
    )

    await waitFor(() => {
      expect(mockDeleteFitnessRouteHeatmap).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'https://llun.test/users/llun',
          periodType: 'yearly',
          periodKey: '2026'
        })
      )
    })

    // The just-removed focused heatmap must not be silently re-queued.
    expect(mockTriggerFitnessRouteHeatmap).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('drops the row even when the server reports it was already removed', async () => {
    mockDeleteFitnessRouteHeatmap.mockResolvedValue(false)
    const failedSummary: FitnessRouteHeatmapSummaryData = {
      ...completedSummary,
      id: 'route-heatmap-already-gone',
      status: 'failed',
      error: 'parse failed'
    }
    mockGetFitnessRouteHeatmap.mockResolvedValue(completedHeatmap)
    mockGetFitnessRouteHeatmaps
      .mockResolvedValueOnce([failedSummary])
      .mockResolvedValue([])

    render(<FitnessHeatmapView actorId="https://llun.test/users/llun" />)

    const removeButton = await screen.findByRole('button', { name: 'Remove' })
    fireEvent.click(removeButton)

    const dialog = screen.getByRole('dialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: /Remove heatmap/i })
    )

    // `deleted: false` is treated as success — no stuck row, no error alert.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(screen.queryByText('parse failed')).not.toBeInTheDocument()
  })

  it('shows determinate progress in the focused preview while generating', async () => {
    const generatingFocused: FitnessRouteHeatmapData = {
      ...completedHeatmap,
      status: 'generating',
      totalCount: 10,
      cursorOffset: 3,
      pointCount: 0,
      bounds: undefined,
      segments: []
    }
    mockGetFitnessRouteHeatmap.mockResolvedValue(generatingFocused)
    mockGetFitnessRouteHeatmaps.mockResolvedValue([completedSummary])

    render(<FitnessHeatmapView actorId="https://llun.test/users/llun" />)

    const preview = await screen.findByRole('region', {
      name: /Route heatmap map/i
    })
    await waitFor(() => {
      expect(
        within(preview).getByText(/3 \/ 10 files \(30%\)/)
      ).toBeInTheDocument()
    })
    expect(within(preview).getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '30'
    )
  })

  it('shows an indeterminate scanned count when the total is unknown', async () => {
    const generatingFocused: FitnessRouteHeatmapData = {
      ...completedHeatmap,
      status: 'generating',
      totalCount: 0,
      cursorOffset: 5,
      pointCount: 0,
      bounds: undefined,
      segments: []
    }
    mockGetFitnessRouteHeatmap.mockResolvedValue(generatingFocused)
    mockGetFitnessRouteHeatmaps.mockResolvedValue([completedSummary])

    render(<FitnessHeatmapView actorId="https://llun.test/users/llun" />)

    const preview = await screen.findByRole('region', {
      name: /Route heatmap map/i
    })
    await waitFor(() => {
      expect(within(preview).getByText(/5 files scanned/)).toBeInTheDocument()
    })
    expect(within(preview).getByRole('progressbar')).not.toHaveAttribute(
      'aria-valuenow'
    )
  })
})

describe('RouteHeatmapMap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the keyless OpenFreeMap map when Mapbox is not configured', async () => {
    const mapConstructor = createGlMapConstructor()
    mockLoadMaplibreModule.mockResolvedValue({ Map: mapConstructor })

    const { container } = render(<RouteHeatmapMap heatmap={completedHeatmap} />)

    await waitFor(() => expect(mapConstructor).toHaveBeenCalled())
    expect(await screen.findByText('OpenFreeMap')).toBeInTheDocument()
    // No static SVG image is generated — the routes render on a real GL map.
    expect(container.querySelector('svg')).not.toBeInTheDocument()
    expect(mockLoadMapboxModule).not.toHaveBeenCalled()
    expect(mapConstructor.mock.calls[0][0]).toMatchObject({
      style: 'https://tiles.openfreemap.org/styles/bright',
      attributionControl: true
    })
  })

  it('renders an empty route state without loading any map provider', () => {
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
    expect(mockLoadMaplibreModule).not.toHaveBeenCalled()
    expect(mockLoadMapboxModule).not.toHaveBeenCalled()
  })

  it('uses Mapbox when a token is configured', async () => {
    const mapConstructor = createGlMapConstructor()
    mockLoadMapboxModule.mockResolvedValue({ Map: mapConstructor })

    const { container } = render(
      <RouteHeatmapMap
        heatmap={completedHeatmap}
        mapboxAccessToken="mapbox-token"
      />
    )

    await waitFor(() => expect(mapConstructor).toHaveBeenCalled())
    expect(await screen.findByText('Mapbox')).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeInTheDocument()
    expect(mockLoadMaplibreModule).not.toHaveBeenCalled()
    expect(mapConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'mapbox-token',
        attributionControl: true
      })
    )
  })

  it('shows a non-SVG fallback message when the map fails to render', async () => {
    const mapConstructor = createGlMapConstructor(() => {
      throw new Error('source unavailable')
    })
    mockLoadMaplibreModule.mockResolvedValue({ Map: mapConstructor })

    const { container } = render(<RouteHeatmapMap heatmap={completedHeatmap} />)

    expect(
      await screen.findByText('Map unavailable. Try regenerating this heatmap.')
    ).toBeInTheDocument()
    expect(screen.queryByText('OpenFreeMap')).not.toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeInTheDocument()
    expect(
      container.querySelector('[data-map-fallback-reason="render-failed"]')
    ).toBeInTheDocument()
    expect(
      container.querySelector('[data-map-fallback-error="source unavailable"]')
    ).toBeInTheDocument()
  })

  it('shows a non-SVG fallback message when the map module fails to load', async () => {
    mockLoadMaplibreModule.mockRejectedValue(new Error('module unavailable'))

    const { container } = render(<RouteHeatmapMap heatmap={completedHeatmap} />)

    expect(
      await screen.findByText('Map unavailable. Try regenerating this heatmap.')
    ).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeInTheDocument()
    expect(
      container.querySelector('[data-map-fallback-reason="module-load-failed"]')
    ).toBeInTheDocument()
    expect(
      container.querySelector('[data-map-fallback-error="module unavailable"]')
    ).toBeInTheDocument()
  })

  it('retries the map when the same route cache is regenerated', async () => {
    const failingMapConstructor = createGlMapConstructor(() => {
      throw new Error('source unavailable')
    })
    mockLoadMaplibreModule.mockResolvedValue({ Map: failingMapConstructor })

    const { container, rerender } = render(
      <RouteHeatmapMap heatmap={completedHeatmap} />
    )

    await waitFor(() =>
      expect(
        container.querySelector('[data-map-fallback-reason="render-failed"]')
      ).toBeInTheDocument()
    )

    const workingMapConstructor = createGlMapConstructor()
    mockLoadMaplibreModule.mockResolvedValue({ Map: workingMapConstructor })

    rerender(
      <RouteHeatmapMap
        heatmap={{
          ...completedHeatmap,
          updatedAt: completedHeatmap.updatedAt + 1
        }}
      />
    )

    await waitFor(() => expect(workingMapConstructor).toHaveBeenCalled())
    expect(await screen.findByText('OpenFreeMap')).toBeInTheDocument()
    expect(
      container.querySelector('[data-map-fallback-reason]')
    ).not.toBeInTheDocument()
  })

  it('downsamples large route caches yet still renders an interactive map', async () => {
    const largeHeatmap = buildLargeHeatmap()
    let renderedFeatureCount = 0
    const mapConstructor = createGlMapConstructor((_id, source) => {
      const data = (source as { data?: { features?: unknown[] } }).data
      renderedFeatureCount = data?.features?.length ?? 0
    })
    mockLoadMaplibreModule.mockResolvedValue({ Map: mapConstructor })

    const { container } = render(<RouteHeatmapMap heatmap={largeHeatmap} />)

    await waitFor(() => expect(mapConstructor).toHaveBeenCalled())
    expect(await screen.findByText('OpenFreeMap')).toBeInTheDocument()
    // Large caches still render on a real GL map (no static SVG, no fallback).
    expect(container.querySelector('svg')).not.toBeInTheDocument()
    expect(
      container.querySelector('[data-map-fallback-reason]')
    ).not.toBeInTheDocument()
    expect(renderedFeatureCount).toBe(largeHeatmap.segments.length)
  })

  it('thins oversized geometry while preserving each segment’s endpoints', () => {
    const longSegment = {
      points: Array.from({ length: 12 }, (_, index) => ({
        lat: index,
        lng: index
      }))
    }
    const shortSegment = {
      points: [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 }
      ]
    }

    const [thinned, untouched] = downsampleSegments(
      [longSegment, shortSegment],
      6
    )

    expect(thinned.points.length).toBeLessThan(longSegment.points.length)
    expect(thinned.points[0]).toEqual(longSegment.points[0])
    expect(thinned.points[thinned.points.length - 1]).toEqual(
      longSegment.points[longSegment.points.length - 1]
    )
    // Segments with two or fewer points are left exactly as-is.
    expect(untouched).toBe(shortSegment)
  })

  it('returns the original segments unchanged when under the budget', () => {
    const segments = [
      {
        points: [
          { lat: 0, lng: 0 },
          { lat: 1, lng: 1 },
          { lat: 2, lng: 2 }
        ]
      }
    ]

    expect(downsampleSegments(segments, 100)).toBe(segments)
  })
})
