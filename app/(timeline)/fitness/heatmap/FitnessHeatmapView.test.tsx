/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
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

// RegionMap is only mounted inside the draw composer; stub it so the picker can
// render without a real GL map in jsdom.
vi.mock('@/lib/components/fitness/RegionMap', () => ({
  RegionMap: () => null
}))

vi.mock('@/lib/client', () => ({
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

const ACTOR = 'https://llun.test/users/llun'
const TEST_NOW = 1_700_000_060_000
const IN_FLIGHT_HISTORY_POLL_WINDOW_MS = 15 * 60_000

const worldSummary = (
  overrides: Partial<FitnessRouteHeatmapSummaryData> = {}
): FitnessRouteHeatmapSummaryData => ({
  id: 'hm-world',
  region: '',
  periodType: 'all_time',
  periodKey: 'all',
  status: 'completed',
  activityCount: 3,
  pointCount: 2,
  totalCount: 1,
  cursorOffset: 0,
  isPartial: false,
  error: null,
  createdAt: 1,
  updatedAt: 2,
  ...overrides
})

const worldHeatmap = (
  overrides: Partial<FitnessRouteHeatmapData> = {}
): FitnessRouteHeatmapData => ({
  id: 'hm-world',
  region: '',
  periodType: 'all_time',
  periodKey: 'all',
  status: 'completed',
  bounds: { minLat: 52.36, maxLat: 52.39, minLng: 4.88, maxLng: 4.91 },
  segments: [
    {
      points: [
        { lat: 52.36, lng: 4.88 },
        { lat: 52.39, lng: 4.91 }
      ]
    }
  ],
  activityCount: 3,
  pointCount: 2,
  totalCount: 1,
  cursorOffset: 0,
  isPartial: false,
  error: null,
  createdAt: 1,
  updatedAt: 2,
  ...overrides
})

const openWorldRegion = async () => {
  const openButton = await screen.findByRole('button', {
    name: /Open Whole world heatmap/i
  })
  fireEvent.click(openButton)
}

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

  return worldHeatmap({
    id: 'route-heatmap-large',
    bounds: { minLat: 52.36, maxLat: 52.39, minLng: 4.88, maxLng: 4.916 },
    segments,
    activityCount: segmentCount,
    pointCount: segmentCount * pointsPerSegment,
    updatedAt: 3
  })
}

describe('FitnessHeatmapView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetDistinctFitnessActivityTypes.mockResolvedValue([])
    mockGetFitnessRouteHeatmap.mockResolvedValue(null)
    mockGetFitnessRouteHeatmaps.mockResolvedValue([])
    mockDeleteFitnessRouteHeatmap.mockResolvedValue(true)
    mockTriggerFitnessRouteHeatmap.mockResolvedValue(true)
    // No Mapbox token in these tests, so the view uses the keyless MapLibre map.
    mockLoadMaplibreModule.mockResolvedValue({ Map: createGlMapConstructor() })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the source panel and a default whole-world region', async () => {
    render(<FitnessHeatmapView actorId={ACTOR} />)

    expect(await screen.findByText('Heatmap source')).toBeInTheDocument()
    // The default whole-world region row (its description is unique to the row,
    // unlike the "Whole world" add button).
    expect(
      screen.getByText('Entire globe — every recorded activity')
    ).toBeInTheDocument()
    // The default region has no heatmap under the all-time source.
    expect(screen.getByText('Not generated')).toBeInTheDocument()
    expect(screen.getByText(/1 region · 0 generated/i)).toBeInTheDocument()
  })

  it('seeds a drawn region from an existing heatmap and shows its status', async () => {
    mockGetFitnessRouteHeatmaps.mockResolvedValue([
      worldSummary({
        id: 'hm-rect',
        region: 'rect:52.60,5.60,52.00,6.20',
        status: 'completed',
        updatedAt: TEST_NOW
      })
    ])

    render(<FitnessHeatmapView actorId={ACTOR} />)

    // The whole world (default) plus the seeded drawn area.
    expect(await screen.findByText('Map area')).toBeInTheDocument()
    expect(screen.getByText(/2 regions · 1 generated/i)).toBeInTheDocument()
    expect(screen.getByText(/^Generated/)).toBeInTheDocument()
  })

  it('opens a region detail page and returns to the list', async () => {
    render(<FitnessHeatmapView actorId={ACTOR} />)

    await openWorldRegion()

    expect(
      await screen.findByRole('button', { name: /All regions/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Whole world' })
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /All regions/i }))
    expect(await screen.findByText('Heatmap source')).toBeInTheDocument()
  })

  it('generates a heatmap for the opened region', async () => {
    render(<FitnessHeatmapView actorId={ACTOR} />)

    await openWorldRegion()

    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate heatmap' })
    )

    await waitFor(() => {
      expect(mockTriggerFitnessRouteHeatmap).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: ACTOR,
          periodType: 'all_time',
          periodKey: 'all',
          retry: false
        })
      )
    })
    // A world region sends no region filter.
    expect(
      mockTriggerFitnessRouteHeatmap.mock.calls[0][0].region
    ).toBeUndefined()
  })

  it('renders the route map and current-version line for a completed region', async () => {
    mockGetFitnessRouteHeatmaps.mockResolvedValue([
      worldSummary({ updatedAt: TEST_NOW })
    ])
    mockGetFitnessRouteHeatmap.mockResolvedValue(worldHeatmap())

    render(<FitnessHeatmapView actorId={ACTOR} />)

    await openWorldRegion()

    expect(await screen.findByText('OpenFreeMap')).toBeInTheDocument()
    expect(screen.getByText(/Current version/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Regenerate/i })
    ).toBeInTheDocument()
  })

  it('retries a failed region heatmap with the resume flag', async () => {
    mockGetFitnessRouteHeatmaps.mockResolvedValue([
      worldSummary({
        status: 'failed',
        error: 'parse failed',
        updatedAt: TEST_NOW
      })
    ])
    mockGetFitnessRouteHeatmap.mockResolvedValue(
      worldHeatmap({
        status: 'failed',
        error: 'parse failed',
        segments: [],
        bounds: null,
        pointCount: 0
      })
    )

    render(<FitnessHeatmapView actorId={ACTOR} />)

    await openWorldRegion()

    const retryButton = await screen.findByRole('button', { name: /Retry/i })
    fireEvent.click(retryButton)

    await waitFor(() => {
      expect(mockTriggerFitnessRouteHeatmap).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: ACTOR, retry: true })
      )
    })
  })

  it('removes a region and prunes its cached heatmap', async () => {
    mockGetFitnessRouteHeatmaps.mockResolvedValue([
      worldSummary({ updatedAt: TEST_NOW })
    ])

    render(<FitnessHeatmapView actorId={ACTOR} />)

    const removeButton = await screen.findByRole('button', {
      name: 'Remove region'
    })
    fireEvent.click(removeButton)

    await waitFor(() => {
      expect(mockDeleteFitnessRouteHeatmap).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: ACTOR,
          periodType: 'all_time',
          periodKey: 'all'
        })
      )
    })
    // The region row is gone (the remaining "Whole world" text is the add button).
    expect(
      screen.queryByRole('button', { name: /Open Whole world heatmap/i })
    ).not.toBeInTheDocument()
    expect(screen.getByText(/No regions yet/i)).toBeInTheDocument()
  })

  it('shows generating progress on the region row', async () => {
    mockGetFitnessRouteHeatmaps.mockResolvedValue([
      worldSummary({
        status: 'generating',
        totalCount: 20,
        cursorOffset: 10,
        updatedAt: TEST_NOW
      })
    ])

    render(<FitnessHeatmapView actorId={ACTOR} />)

    expect(await screen.findByText(/Generating… 50%/)).toBeInTheDocument()
  })

  it('surfaces a generation error in the detail view', async () => {
    mockTriggerFitnessRouteHeatmap.mockRejectedValueOnce(
      new Error('queue unavailable')
    )

    render(<FitnessHeatmapView actorId={ACTOR} />)

    await openWorldRegion()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate heatmap' })
    )

    expect(await screen.findByText('queue unavailable')).toBeInTheDocument()
  })

  it('keeps polling fresh in-flight regions without stalling', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(TEST_NOW)
    mockGetFitnessRouteHeatmaps.mockResolvedValue([
      worldSummary({
        status: 'generating',
        totalCount: 20,
        cursorOffset: 5,
        updatedAt: TEST_NOW - IN_FLIGHT_HISTORY_POLL_WINDOW_MS
      })
    ])

    render(<FitnessHeatmapView actorId={ACTOR} />)

    await waitFor(() => {
      expect(mockGetFitnessRouteHeatmaps).toHaveBeenCalledTimes(1)
    })

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
  })

  it('does not poll stale in-flight regions', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(TEST_NOW)
    mockGetFitnessRouteHeatmaps.mockResolvedValue([
      worldSummary({
        status: 'generating',
        totalCount: 20,
        cursorOffset: 5,
        updatedAt: TEST_NOW - IN_FLIGHT_HISTORY_POLL_WINDOW_MS - 1
      })
    ])

    render(<FitnessHeatmapView actorId={ACTOR} />)

    await waitFor(() => {
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
})

describe('RouteHeatmapMap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the keyless OpenFreeMap map when Mapbox is not configured', async () => {
    const mapConstructor = createGlMapConstructor()
    mockLoadMaplibreModule.mockResolvedValue({ Map: mapConstructor })

    const { container } = render(<RouteHeatmapMap heatmap={worldHeatmap()} />)

    await waitFor(() => expect(mapConstructor).toHaveBeenCalled())
    expect(await screen.findByText('OpenFreeMap')).toBeInTheDocument()
    // No static SVG image is generated — the routes render on a real GL map.
    expect(container.querySelector('svg')).not.toBeInTheDocument()
    // The GL container keeps an accessible name (the removed SVG used to carry it).
    expect(
      screen.getByRole('img', { name: 'Fitness route heatmap' })
    ).toBeInTheDocument()
    expect(mockLoadMapboxModule).not.toHaveBeenCalled()
    expect(mapConstructor.mock.calls[0][0]).toMatchObject({
      style: 'https://tiles.openfreemap.org/styles/bright',
      attributionControl: true
    })
  })

  it('shows a loading indicator until the map finishes initializing', async () => {
    const deferred = createDeferred<{ Map: ReturnType<typeof vi.fn> }>()
    mockLoadMaplibreModule.mockReturnValue(deferred.promise)

    render(<RouteHeatmapMap heatmap={worldHeatmap()} />)

    // The module hasn't resolved yet, so the map is still initializing.
    expect(await screen.findByText('Loading map…')).toBeInTheDocument()
    expect(screen.queryByText('OpenFreeMap')).not.toBeInTheDocument()

    await act(async () => {
      deferred.resolve({ Map: createGlMapConstructor() })
      await Promise.resolve()
    })

    expect(await screen.findByText('OpenFreeMap')).toBeInTheDocument()
    expect(screen.queryByText('Loading map…')).not.toBeInTheDocument()
  })

  it('pushes updated geometry to the existing source when the cache changes', async () => {
    const setData = vi.fn()
    const mapConstructor = createGlMapConstructor()
    mapConstructor.mockImplementation(function () {
      return {
        on: (_event: string, callback: () => void) => callback(),
        remove: vi.fn(),
        resize: vi.fn(),
        addSource: vi.fn(),
        addLayer: vi.fn(),
        getSource: vi.fn(() => ({ setData })),
        fitBounds: vi.fn()
      }
    })
    mockLoadMaplibreModule.mockResolvedValue({ Map: mapConstructor })

    const { rerender } = render(<RouteHeatmapMap heatmap={worldHeatmap()} />)
    await screen.findByText('OpenFreeMap')
    setData.mockClear()

    rerender(
      <RouteHeatmapMap
        heatmap={worldHeatmap({
          updatedAt: 3,
          segments: [
            {
              points: [
                { lat: 52.36, lng: 4.88 },
                { lat: 52.37, lng: 4.89 },
                { lat: 52.39, lng: 4.91 }
              ]
            }
          ]
        })}
      />
    )

    await waitFor(() => expect(setData).toHaveBeenCalledTimes(1))
  })

  it('renders an empty route state without loading any map provider', () => {
    render(
      <RouteHeatmapMap
        heatmap={worldHeatmap({ segments: [], pointCount: 0, bounds: null })}
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
        heatmap={worldHeatmap()}
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

    const { container } = render(<RouteHeatmapMap heatmap={worldHeatmap()} />)

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

    const { container } = render(<RouteHeatmapMap heatmap={worldHeatmap()} />)

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

  it('falls back when the map never reaches its load event', async () => {
    vi.useFakeTimers()
    try {
      // A map double whose 'load' event never fires (e.g. the style never
      // fetches), so only the load watchdog can resolve the loading state.
      const mapConstructor = vi.fn().mockImplementation(function () {
        return {
          on: vi.fn(),
          remove: vi.fn(),
          resize: vi.fn(),
          addSource: vi.fn(),
          addLayer: vi.fn(),
          getSource: vi.fn(),
          fitBounds: vi.fn()
        }
      })
      mockLoadMaplibreModule.mockResolvedValue({ Map: mapConstructor })

      const { container } = render(<RouteHeatmapMap heatmap={worldHeatmap()} />)

      // Flush the module-load promise so the map is created and the watchdog armed.
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(mapConstructor).toHaveBeenCalled()
      expect(screen.getByText('Loading map…')).toBeInTheDocument()

      await act(async () => {
        vi.advanceTimersByTime(20_000)
      })

      expect(
        screen.getByText('Map unavailable. Try regenerating this heatmap.')
      ).toBeInTheDocument()
      expect(
        container.querySelector('[data-map-fallback-reason="load-timeout"]')
      ).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a successfully loaded map past the watchdog window', async () => {
    vi.useFakeTimers()
    try {
      // This GL double fires 'load' synchronously, so the watchdog is cleared.
      const mapConstructor = createGlMapConstructor()
      mockLoadMaplibreModule.mockResolvedValue({ Map: mapConstructor })

      const { container } = render(<RouteHeatmapMap heatmap={worldHeatmap()} />)

      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(screen.getByText('OpenFreeMap')).toBeInTheDocument()

      // Advancing past the 20s watchdog must NOT flip a loaded map to the
      // fallback — the success path clears the timer.
      await act(async () => {
        vi.advanceTimersByTime(20_000)
      })

      expect(screen.getByText('OpenFreeMap')).toBeInTheDocument()
      expect(
        screen.queryByText('Map unavailable. Try regenerating this heatmap.')
      ).not.toBeInTheDocument()
      expect(
        container.querySelector('[data-map-fallback-reason]')
      ).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries the map when the same route cache is regenerated', async () => {
    const failingMapConstructor = createGlMapConstructor(() => {
      throw new Error('source unavailable')
    })
    mockLoadMaplibreModule.mockResolvedValue({ Map: failingMapConstructor })

    const { container, rerender } = render(
      <RouteHeatmapMap heatmap={worldHeatmap()} />
    )

    await waitFor(() =>
      expect(
        container.querySelector('[data-map-fallback-reason="render-failed"]')
      ).toBeInTheDocument()
    )

    const workingMapConstructor = createGlMapConstructor()
    mockLoadMaplibreModule.mockResolvedValue({ Map: workingMapConstructor })

    rerender(<RouteHeatmapMap heatmap={worldHeatmap({ updatedAt: 3 })} />)

    await waitFor(() => expect(workingMapConstructor).toHaveBeenCalled())
    expect(await screen.findByText('OpenFreeMap')).toBeInTheDocument()
    expect(
      container.querySelector('[data-map-fallback-reason]')
    ).not.toBeInTheDocument()
  })

  it('downsamples large route caches yet still renders an interactive map', async () => {
    const largeHeatmap = buildLargeHeatmap()
    let renderedFeatureCount = 0
    let renderedVertexCount = 0
    const mapConstructor = createGlMapConstructor((_id, source) => {
      const features =
        (
          source as {
            data?: { features?: { geometry: { coordinates: unknown[] } }[] }
          }
        ).data?.features ?? []
      renderedFeatureCount = features.length
      renderedVertexCount = features.reduce(
        (sum, feature) => sum + feature.geometry.coordinates.length,
        0
      )
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
    // Every route still renders, but the geometry handed to the GL layer is
    // actually thinned — far below the raw point count and near the budget.
    expect(renderedFeatureCount).toBe(largeHeatmap.segments.length)
    expect(renderedVertexCount).toBeGreaterThan(0)
    expect(renderedVertexCount).toBeLessThan(largeHeatmap.pointCount)
    expect(renderedVertexCount).toBeLessThanOrEqual(50_000)
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

    const result = downsampleSegments([longSegment, shortSegment], 6)
    const [thinned, untouched] = result

    // No segment is dropped — the route count is preserved.
    expect(result).toHaveLength(2)
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
