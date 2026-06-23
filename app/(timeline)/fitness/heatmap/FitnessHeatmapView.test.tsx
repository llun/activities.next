/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  deleteFitnessRouteHeatmap,
  getDistinctFitnessActivityTypes,
  getFitnessRouteHeatmap,
  getFitnessRouteHeatmapRegionNames,
  getFitnessRouteHeatmaps,
  setFitnessRouteHeatmapRegionName,
  triggerFitnessRouteHeatmap
} from '@/lib/client'
import type {
  FitnessRouteHeatmapData,
  FitnessRouteHeatmapRegionNameData,
  FitnessRouteHeatmapSummaryData
} from '@/lib/client'
import { loadMapboxModule } from '@/lib/utils/mapbox'
import { loadMaplibreModule } from '@/lib/utils/maplibre'

import {
  FitnessHeatmapView,
  RouteHeatmapMap,
  computeFocusBounds,
  downsampleSegments
} from './FitnessHeatmapView'

vi.mock('@/lib/utils/mapbox', () => ({
  loadMapboxModule: vi.fn()
}))

vi.mock('@/lib/utils/maplibre', () => ({
  OPENFREEMAP_STYLE_URL: 'https://tiles.openfreemap.org/styles/bright',
  OPENFREEMAP_HEATMAP_STYLE_URL:
    'https://tiles.openfreemap.org/styles/positron',
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
  getFitnessRouteHeatmapRegionNames: vi.fn(),
  getFitnessRouteHeatmaps: vi.fn(),
  setFitnessRouteHeatmapRegionName: vi.fn(),
  shareFitnessRouteHeatmap: vi.fn(),
  triggerFitnessRouteHeatmap: vi.fn(),
  unshareFitnessRouteHeatmap: vi.fn()
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
const mockGetFitnessRouteHeatmapRegionNames =
  getFitnessRouteHeatmapRegionNames as jest.MockedFunction<
    typeof getFitnessRouteHeatmapRegionNames
  >
const mockSetFitnessRouteHeatmapRegionName =
  setFitnessRouteHeatmapRegionName as jest.MockedFunction<
    typeof setFitnessRouteHeatmapRegionName
  >
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

// A denser route cluster ~100° of longitude away from the Amsterdam fixture, so a
// whole-world cache containing both spans the globe. computeFocusBounds tightens
// the initial view to this (denser) cluster instead of the global extent.
const SINGAPORE_CLUSTER_POINTS = [
  { lat: 1.3, lng: 103.7 },
  { lat: 1.32, lng: 103.75 },
  { lat: 1.35, lng: 103.8 },
  { lat: 1.37, lng: 103.85 },
  { lat: 1.4, lng: 103.9 },
  { lat: 1.33, lng: 103.78 }
]
const SINGAPORE_CLUSTER_BOUNDS = {
  minLat: 1.3,
  maxLat: 1.4,
  minLng: 103.7,
  maxLng: 103.9
}

// Whole-world cache with two disjoint regions: a small Amsterdam cluster (2
// points) and the denser Singapore cluster above.
const disjointWorldHeatmap = (
  overrides: Partial<FitnessRouteHeatmapData> = {}
): FitnessRouteHeatmapData =>
  worldHeatmap({
    bounds: { minLat: 1.3, maxLat: 52.39, minLng: 4.88, maxLng: 103.9 },
    segments: [
      {
        points: [
          { lat: 52.36, lng: 4.88 },
          { lat: 52.39, lng: 4.91 }
        ]
      },
      { points: SINGAPORE_CLUSTER_POINTS }
    ],
    ...overrides
  })

// A GL map double that captures the bounds/options handed to fitBounds, so a
// test can assert the initial framing (full extent vs. focused dense cluster).
const createFitBoundsCapturingModule = () => {
  const fitBounds = vi.fn()
  const Map = vi.fn().mockImplementation(function () {
    return {
      on: (_event: string, callback: () => void) => callback(),
      remove: vi.fn(),
      resize: vi.fn(),
      addSource: vi.fn(),
      addLayer: vi.fn(),
      getSource: vi.fn(),
      fitBounds
    }
  })
  return { Map, fitBounds }
}

describe('FitnessHeatmapView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetDistinctFitnessActivityTypes.mockResolvedValue([])
    mockGetFitnessRouteHeatmap.mockResolvedValue(null)
    mockGetFitnessRouteHeatmaps.mockResolvedValue([])
    mockGetFitnessRouteHeatmapRegionNames.mockResolvedValue([])
    mockSetFitnessRouteHeatmapRegionName.mockResolvedValue(true)
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

  it('rehydrates a saved region name instead of showing "Map area"', async () => {
    mockGetFitnessRouteHeatmaps.mockResolvedValue([
      worldSummary({
        id: 'hm-rect',
        region: 'rect:52.60,5.60,52.00,6.20',
        status: 'completed',
        updatedAt: TEST_NOW
      })
    ])
    mockGetFitnessRouteHeatmapRegionNames.mockResolvedValue([
      { region: 'rect:52.60,5.60,52.00,6.20', name: 'Veluwe loop' }
    ])

    render(<FitnessHeatmapView actorId={ACTOR} />)

    // The persisted label is used; the generic fallback never appears.
    expect(await screen.findByText('Veluwe loop')).toBeInTheDocument()
    expect(screen.queryByText('Map area')).not.toBeInTheDocument()
  })

  it('persists a region name when an area is saved', async () => {
    render(<FitnessHeatmapView actorId={ACTOR} />)

    // Open the draw composer, give the area a name, and save it.
    fireEvent.click(
      await screen.findByRole('button', { name: /Draw area on map/i })
    )
    fireEvent.change(screen.getByPlaceholderText(/Veluwe loop/i), {
      target: { value: 'Coastal ride' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add area' }))

    await waitFor(() =>
      expect(mockSetFitnessRouteHeatmapRegionName).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: ACTOR, name: 'Coastal ride' })
      )
    )
    // The saved region key is a canonical, non-empty rect token.
    const call = mockSetFitnessRouteHeatmapRegionName.mock.calls[0][0]
    expect(call.region).toMatch(/^rect:/)
  })

  const drawAndSaveArea = async (name: string) => {
    fireEvent.click(
      await screen.findByRole('button', { name: /Draw area on map/i })
    )
    fireEvent.change(screen.getByPlaceholderText(/Veluwe loop/i), {
      target: { value: name }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add area' }))
  }

  it('surfaces an error when saving a region name is rejected by the server', async () => {
    mockSetFitnessRouteHeatmapRegionName.mockResolvedValue(false)
    render(<FitnessHeatmapView actorId={ACTOR} />)

    await drawAndSaveArea('Coastal ride')

    expect(
      await screen.findByText(/Couldn't save the region name/i)
    ).toBeInTheDocument()
  })

  it('surfaces an error when saving a region name throws', async () => {
    mockSetFitnessRouteHeatmapRegionName.mockRejectedValue(
      new Error('network down')
    )
    render(<FitnessHeatmapView actorId={ACTOR} />)

    await drawAndSaveArea('Coastal ride')

    expect(
      await screen.findByText(/Couldn't save the region name/i)
    ).toBeInTheDocument()
  })

  it('clears a prior save error once a later save succeeds', async () => {
    mockSetFitnessRouteHeatmapRegionName.mockResolvedValueOnce(false)
    render(<FitnessHeatmapView actorId={ACTOR} />)

    await drawAndSaveArea('Coastal ride')
    expect(
      await screen.findByText(/Couldn't save the region name/i)
    ).toBeInTheDocument()

    // Re-saving the same area now succeeds; the stale error must clear.
    mockSetFitnessRouteHeatmapRegionName.mockResolvedValue(true)
    fireEvent.click(screen.getByRole('button', { name: /Edit area/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Save area' }))

    await waitFor(() =>
      expect(
        screen.queryByText(/Couldn't save the region name/i)
      ).not.toBeInTheDocument()
    )
  })

  it('keeps an in-session rename made while the initial names fetch is in flight', async () => {
    // Heatmaps resolve immediately; the names fetch stays pending so the mount
    // load is still in flight while the user renames.
    mockGetFitnessRouteHeatmaps.mockResolvedValue([])
    const namesDeferred = createDeferred<FitnessRouteHeatmapRegionNameData[]>()
    mockGetFitnessRouteHeatmapRegionNames.mockReturnValue(namesDeferred.promise)

    render(<FitnessHeatmapView actorId={ACTOR} />)

    // Draw + name an area whose canonical key already has a (now-stale) stored
    // name on the server — the default box serializes to this key.
    await drawAndSaveArea('New name')
    expect(await screen.findByText('New name')).toBeInTheDocument()

    // The in-flight names fetch resolves with the OLD label for that same key.
    await act(async () => {
      namesDeferred.resolve([
        { region: 'rect:53.00,3.00,50.00,7.00', name: 'Old name' }
      ])
    })

    // The user's in-session rename must win; the stale snapshot must not revert
    // it (it self-corrects to the server value on the next reload anyway).
    expect(await screen.findByText('New name')).toBeInTheDocument()
    expect(screen.queryByText('Old name')).not.toBeInTheDocument()
  })

  it('ignores a saved name whose region key matches no current region', async () => {
    mockGetFitnessRouteHeatmaps.mockResolvedValue([
      worldSummary({
        id: 'hm-rect',
        region: 'rect:52.60,5.60,52.00,6.20',
        status: 'completed',
        updatedAt: TEST_NOW
      })
    ])
    // A stale label for a different region key (e.g. a removed region).
    mockGetFitnessRouteHeatmapRegionNames.mockResolvedValue([
      { region: 'rect:10.00,10.00,9.00,11.00', name: 'Stale label' }
    ])

    render(<FitnessHeatmapView actorId={ACTOR} />)

    // The discovered region keeps the generic fallback; the unrelated label is
    // not applied to it (and does not crash the render).
    expect(await screen.findByText('Map area')).toBeInTheDocument()
    expect(screen.queryByText('Stale label')).not.toBeInTheDocument()
  })

  it('still loads heatmaps when the region-names fetch fails', async () => {
    mockGetFitnessRouteHeatmaps.mockResolvedValue([
      worldSummary({
        id: 'hm-rect',
        region: 'rect:52.60,5.60,52.00,6.20',
        status: 'completed',
        updatedAt: TEST_NOW
      })
    ])
    mockGetFitnessRouteHeatmapRegionNames.mockRejectedValue(
      new Error('names fetch failed')
    )

    render(<FitnessHeatmapView actorId={ACTOR} />)

    // The discovered region still appears (labels just fall back to "Map area").
    expect(await screen.findByText('Map area')).toBeInTheDocument()
    expect(screen.getByText(/2 regions · 1 generated/i)).toBeInTheDocument()
  })

  it('opens a region detail page and returns to the list', async () => {
    render(<FitnessHeatmapView actorId={ACTOR} />)

    await openWorldRegion()

    expect(
      await screen.findByRole('button', { name: /All regions/i })
    ).toBeInTheDocument()
    // The detail region title is an h2 (the page-level PageHeader owns the h1).
    expect(
      screen.getByRole('heading', { level: 2, name: 'Whole world' })
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

  it('sends the rect token when generating a seeded drawn region', async () => {
    const rectKey = 'rect:52.60,5.60,52.00,6.20'
    mockGetFitnessRouteHeatmaps.mockResolvedValue([
      worldSummary({
        id: 'hm-rect',
        region: rectKey,
        status: 'failed',
        error: 'parse failed',
        updatedAt: TEST_NOW
      })
    ])
    mockGetFitnessRouteHeatmap.mockResolvedValue(
      worldHeatmap({
        id: 'hm-rect',
        region: rectKey,
        status: 'failed',
        error: 'parse failed',
        segments: [],
        bounds: null,
        pointCount: 0
      })
    )

    render(<FitnessHeatmapView actorId={ACTOR} />)

    fireEvent.click(
      await screen.findByRole('button', { name: /Open Map area heatmap/i })
    )

    const retryButton = await screen.findByRole('button', { name: /Retry/i })
    fireEvent.click(retryButton)

    await waitFor(() => {
      expect(mockTriggerFitnessRouteHeatmap).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: ACTOR,
          region: rectKey,
          retry: true
        })
      )
    })
  })

  it('re-derives region status when the period source changes', async () => {
    mockGetFitnessRouteHeatmaps.mockResolvedValue([
      worldSummary({ updatedAt: TEST_NOW })
    ])

    render(<FitnessHeatmapView actorId={ACTOR} />)

    // The all-time heatmap matches the default source.
    expect(await screen.findByText(/^Generated/)).toBeInTheDocument()

    // Switching to a yearly source re-keys the region; the all-time heatmap no
    // longer matches, so the row flips to "Not generated".
    fireEvent.change(screen.getByRole('combobox', { name: 'Period' }), {
      target: { value: 'yearly' }
    })

    await waitFor(() =>
      expect(screen.getByText('Not generated')).toBeInTheDocument()
    )
    expect(screen.queryByText(/^Generated/)).not.toBeInTheDocument()
  })

  it('seeds and dedupes regions from legacy multi-region heatmap keys', async () => {
    // A legacy multi-rect key splits into two distinct regions; the world '' key
    // is already represented by the default world region (so it is not re-added).
    mockGetFitnessRouteHeatmaps.mockResolvedValue([
      worldSummary({
        id: 'hm-multi',
        region: 'rect:52.60,5.60,52.00,6.20;rect:48.00,2.00,47.00,3.00',
        status: 'completed',
        updatedAt: TEST_NOW
      }),
      worldSummary({ id: 'hm-world', region: '', updatedAt: TEST_NOW })
    ])

    render(<FitnessHeatmapView actorId={ACTOR} />)

    // 1 world (default) + 2 split rects = 3 regions. Only the world matches a
    // single-region heatmap ('' key); the legacy multi-rect key doesn't map to
    // either split rect, so those read "Not generated".
    expect(
      await screen.findByText(/3 regions · 1 generated/i)
    ).toBeInTheDocument()
    // Exactly one whole-world row (the '' key did not duplicate it).
    expect(
      screen.getAllByRole('button', { name: /Open Whole world heatmap/i })
    ).toHaveLength(1)
  })

  it('clears the generating row when polling reports completion', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(TEST_NOW)
    mockGetFitnessRouteHeatmaps
      .mockResolvedValueOnce([
        worldSummary({
          status: 'generating',
          totalCount: 20,
          cursorOffset: 5,
          updatedAt: TEST_NOW
        })
      ])
      .mockResolvedValue([
        worldSummary({ status: 'completed', updatedAt: TEST_NOW })
      ])

    render(<FitnessHeatmapView actorId={ACTOR} />)

    // Flush the initial heatmaps fetch.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByText(/Generating… 25%/)).toBeInTheDocument()

    // The next list poll returns a completed summary.
    await act(async () => {
      vi.advanceTimersByTime(5000)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByText(/^Generated/)).toBeInTheDocument()
    expect(screen.queryByText(/Generating…/)).not.toBeInTheDocument()
  })

  it('surfaces the stalled state after repeated no-progress focused polls', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(TEST_NOW)
    // A focused region whose generating fingerprint never advances, so each poll
    // counts toward STALLED_POLLING_LIMIT.
    const stuck = worldHeatmap({
      id: 'stuck',
      status: 'generating',
      segments: [],
      bounds: null,
      pointCount: 0,
      totalCount: 20,
      cursorOffset: 5,
      updatedAt: TEST_NOW
    })
    mockGetFitnessRouteHeatmap.mockResolvedValue(stuck)
    mockGetFitnessRouteHeatmaps.mockResolvedValue([
      worldSummary({
        id: 'stuck',
        status: 'generating',
        totalCount: 20,
        cursorOffset: 5,
        updatedAt: TEST_NOW
      })
    ])

    render(<FitnessHeatmapView actorId={ACTOR} />)

    // The default world row renders synchronously; open it.
    fireEvent.click(
      screen.getByRole('button', { name: /Open Whole world heatmap/i })
    )
    // Flush the focused fetch so the detail enters the generating state.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('Building your heatmap…')).toBeInTheDocument()

    // Drive past STALLED_POLLING_LIMIT (30) poll cycles of 5s each.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000 * 32)
    })

    expect(screen.getByText(/taking longer than expected/i)).toBeInTheDocument()
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
    // The keyless path uses the light "positron" basemap so the routes stay legible.
    expect(mapConstructor.mock.calls[0][0]).toMatchObject({
      style: 'https://tiles.openfreemap.org/styles/positron',
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
        attributionControl: true,
        // Light 2D basemap + flat mercator projection (no zoomed-out globe).
        style: 'mapbox://styles/mapbox/light-v11',
        projection: 'mercator'
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

  it('fits the full bounds (no zoom cap) for a single contiguous region', async () => {
    const { Map, fitBounds } = createFitBoundsCapturingModule()
    mockLoadMaplibreModule.mockResolvedValue({ Map })

    render(<RouteHeatmapMap heatmap={worldHeatmap()} />)

    await waitFor(() => expect(fitBounds).toHaveBeenCalled())
    expect(fitBounds.mock.calls[0][0]).toEqual([
      [4.88, 52.36],
      [4.91, 52.39]
    ])
    // A single region keeps the natural fit — no focus zoom cap is applied.
    expect(fitBounds.mock.calls[0][1]).not.toHaveProperty('maxZoom')
    expect(fitBounds.mock.calls[0][1]).toMatchObject({
      padding: 56,
      duration: 0
    })
  })

  it('opens focused on the densest cluster for a disjoint multi-region cache', async () => {
    const { Map, fitBounds } = createFitBoundsCapturingModule()
    mockLoadMaplibreModule.mockResolvedValue({ Map })

    render(<RouteHeatmapMap heatmap={disjointWorldHeatmap()} />)

    await waitFor(() => expect(fitBounds).toHaveBeenCalled())
    // The initial view tightens to the dense Singapore cluster (not the global
    // Europe→Singapore extent) and caps the zoom so it opens with pannable context.
    expect(fitBounds.mock.calls[0][0]).toEqual([
      [SINGAPORE_CLUSTER_BOUNDS.minLng, SINGAPORE_CLUSTER_BOUNDS.minLat],
      [SINGAPORE_CLUSTER_BOUNDS.maxLng, SINGAPORE_CLUSTER_BOUNDS.maxLat]
    ])
    expect(fitBounds.mock.calls[0][1]).toMatchObject({
      padding: 56,
      duration: 0,
      maxZoom: 12
    })
  })
})

describe('computeFocusBounds', () => {
  it('keeps the full bounds for a single contiguous region', () => {
    const bounds = { minLat: 52.36, maxLat: 52.39, minLng: 4.88, maxLng: 4.91 }
    const result = computeFocusBounds(
      [
        {
          points: [
            { lat: 52.36, lng: 4.88 },
            { lat: 52.39, lng: 4.91 }
          ]
        }
      ],
      bounds
    )

    expect(result.focused).toBe(false)
    expect(result.bounds).toBe(bounds)
  })

  it('keeps the full bounds for a region spanning several adjacent cells', () => {
    // Points spread contiguously across ~8° of longitude (several 5° cells that
    // are 8-connected), so there is a single cluster — show the whole extent.
    const bounds = { minLat: 50, maxLat: 52, minLng: 4, maxLng: 12 }
    const result = computeFocusBounds(
      [
        {
          points: [
            { lat: 50, lng: 4 },
            { lat: 51, lng: 8 },
            { lat: 52, lng: 12 }
          ]
        }
      ],
      bounds
    )

    expect(result.focused).toBe(false)
    expect(result.bounds).toBe(bounds)
  })

  it('tightens to the densest cluster for disjoint regions', () => {
    const bounds = { minLat: 1.3, maxLat: 52.39, minLng: 4.88, maxLng: 103.9 }
    const result = computeFocusBounds(
      [
        {
          points: [
            { lat: 52.36, lng: 4.88 },
            { lat: 52.39, lng: 4.91 }
          ]
        },
        { points: SINGAPORE_CLUSTER_POINTS }
      ],
      bounds
    )

    expect(result.focused).toBe(true)
    expect(result.bounds).toEqual(SINGAPORE_CLUSTER_BOUNDS)
  })

  it('ignores a sparse far-away outlier and frames the main cluster', () => {
    const bounds = { minLat: 52.36, maxLat: 52.39, minLng: 4.88, maxLng: 40 }
    const result = computeFocusBounds(
      [
        {
          points: [
            { lat: 52.36, lng: 4.88 },
            { lat: 52.37, lng: 4.89 },
            { lat: 52.39, lng: 4.91 }
          ]
        },
        // A single stray point far east in its own, disconnected cell.
        { points: [{ lat: 52.36, lng: 40 }] }
      ],
      bounds
    )

    expect(result.focused).toBe(true)
    expect(result.bounds).toEqual({
      minLat: 52.36,
      maxLat: 52.39,
      minLng: 4.88,
      maxLng: 4.91
    })
  })

  it('returns the full bounds for an empty segment list', () => {
    const bounds = { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 }
    const result = computeFocusBounds([], bounds)

    expect(result.focused).toBe(false)
    expect(result.bounds).toBe(bounds)
  })

  it('skips non-finite vertices so they create no spurious cluster', () => {
    const bounds = { minLat: 52.36, maxLat: 52.39, minLng: 4.88, maxLng: 4.91 }
    const result = computeFocusBounds(
      [
        {
          points: [
            { lat: 52.36, lng: 4.88 },
            { lat: 52.39, lng: 4.91 }
          ]
        },
        // An entirely non-finite segment must contribute no grid cell; otherwise
        // it would look like a second region and flip the result to focused.
        {
          points: [
            { lat: NaN, lng: NaN },
            { lat: Infinity, lng: -Infinity }
          ]
        }
      ],
      bounds
    )

    expect(result.focused).toBe(false)
    expect(result.bounds).toBe(bounds)
  })

  it('ignores non-finite vertices when framing a focused cluster', () => {
    const bounds = { minLat: 1.3, maxLat: 52.39, minLng: 4.88, maxLng: 103.9 }
    const result = computeFocusBounds(
      [
        {
          points: [
            { lat: 52.36, lng: 4.88 },
            { lat: 52.37, lng: 4.89 },
            { lat: 52.39, lng: 4.91 }
          ]
        },
        // The denser cluster carries a stray non-finite vertex that must not
        // widen (or NaN-poison) the focused box.
        { points: [{ lat: NaN, lng: 103.8 }, ...SINGAPORE_CLUSTER_POINTS] }
      ],
      bounds
    )

    expect(result.focused).toBe(true)
    expect(result.bounds).toEqual(SINGAPORE_CLUSTER_BOUNDS)
  })

  it('does not merge clusters straddling the antimeridian (documented limitation)', () => {
    // Two clusters at opposite signs near ±180° lon fall in non-adjacent grid
    // cells, so the focus frames only the denser one rather than spanning the
    // shorter way around the globe.
    const bounds = { minLat: 0, maxLat: 1, minLng: -179.9, maxLng: 179.9 }
    const result = computeFocusBounds(
      [
        {
          points: [
            { lat: 0.5, lng: 179.5 },
            { lat: 0.6, lng: 179.7 },
            { lat: 0.55, lng: 179.9 }
          ]
        },
        { points: [{ lat: 0.5, lng: -179.9 }] }
      ],
      bounds
    )

    expect(result.focused).toBe(true)
    expect(result.bounds).toEqual({
      minLat: 0.5,
      maxLat: 0.6,
      minLng: 179.5,
      maxLng: 179.9
    })
  })

  it('merges cells that touch only diagonally (8-connectivity)', () => {
    const bounds = { minLat: 52, maxLat: 55, minLng: 4, maxLng: 8 }
    // The two 5° cells (0:10 and 1:11) are diagonal neighbours — connected only
    // at a corner. 8-connectivity merges them into one contiguous cluster, so
    // the full bounds are kept (a 4-connected flood fill would NOT merge these).
    const result = computeFocusBounds(
      [
        {
          points: [
            { lat: 52, lng: 4 },
            { lat: 55, lng: 8 }
          ]
        }
      ],
      bounds
    )

    expect(result.focused).toBe(false)
    expect(result.bounds).toBe(bounds)
  })

  it('does not merge cells a knight’s-move apart, focusing the densest cell', () => {
    const bounds = { minLat: 52, maxLat: 55, minLng: 4, maxLng: 13 }
    // Cell 0:10 (two points) is strictly denser than cell 2:11 (one point), and
    // the two cells are a knight's move apart (dx=2), so they stay separate — this
    // pins that grid adjacency (not mere proximity) is what merges clusters, and
    // that the seed is chosen by density rather than Map insertion order.
    const result = computeFocusBounds(
      [
        {
          points: [
            { lat: 52, lng: 4 },
            { lat: 53, lng: 4 },
            { lat: 55, lng: 13 }
          ]
        }
      ],
      bounds
    )

    expect(result.focused).toBe(true)
    expect(result.bounds).toEqual({
      minLat: 52,
      maxLat: 53,
      minLng: 4,
      maxLng: 4
    })
  })

  it('frames the densest cell even when another cluster has more cells', () => {
    // Cluster A spans two 8-adjacent cells (0:0 and 0:1) of one point each — the
    // largest connected cluster by cell count. Cluster B is a single isolated cell
    // (8:0) holding three points — the densest cell. The focus must frame B (seed
    // = densest cell, then its cluster), proving the helper does not instead pick
    // the cluster with the most cells.
    const bounds = { minLat: 0, maxLat: 7, minLng: 2, maxLng: 40.2 }
    const result = computeFocusBounds(
      [
        {
          points: [
            { lat: 2, lng: 2 },
            { lat: 7, lng: 2 }
          ]
        },
        {
          points: [
            { lat: 0, lng: 40 },
            { lat: 0.1, lng: 40.1 },
            { lat: 0.2, lng: 40.2 }
          ]
        }
      ],
      bounds
    )

    expect(result.focused).toBe(true)
    expect(result.bounds).toEqual({
      minLat: 0,
      maxLat: 0.2,
      minLng: 40,
      maxLng: 40.2
    })
  })
})
