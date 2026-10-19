/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'

import { preloadInlineStatusComposer } from '@/lib/components/posts/lazy-inline-status-composer'
import type { Status, StatusNote } from '@/lib/types/domain/status'
import { loadMaplibreModule } from '@/lib/utils/maplibre'

import { REPLIES_EXPANDED_STORAGE_KEY } from './ActivityReplies'
import { mockPush } from './FitnessStatusDetail.mocks'
import {
  actor,
  buildFitnessFile,
  buildStatus,
  chooseRecording,
  getRecordingRow,
  mockGetFitnessFilesByStatus,
  mockGetFitnessRouteData,
  openRecordingPicker,
  recordingTriggerName,
  renderDetail,
  resetFitnessStatusDetailMocks
} from './FitnessStatusDetail.testUtils'
import { ROUTE_DATA_ERROR_MESSAGE } from './useActivityRouteData'

vi.mock('@/lib/client', () => ({
  getFitnessFilesByStatus: vi.fn(),
  getFitnessGearList: vi.fn(),
  getFitnessRouteData: vi.fn(),
  makeFitnessFilePrimary: vi.fn(),
  updateFitnessFileGear: vi.fn()
}))

vi.mock('@/lib/utils/mapbox', () => ({
  loadMapboxModule: vi.fn()
}))

// The keyless GL loader never resolves here, so the interactive map stays in its
// initializing state (no real MapLibre script is injected in jsdom).
vi.mock('@/lib/utils/maplibre', () => ({
  loadMaplibreModule: vi.fn(() => new Promise(() => {})),
  OPENFREEMAP_STYLE_URL: 'https://tiles.openfreemap.org/styles/bright',
  OPENFREEMAP_HEATMAP_STYLE_URL: 'https://tiles.openfreemap.org/styles/positron'
}))

vi.mock('next/navigation', async () => {
  const { mockPush, mockRefresh } = await import('./FitnessStatusDetail.mocks')
  return { useRouter: () => ({ refresh: mockRefresh, push: mockPush }) }
})

vi.mock('@/lib/utils/getStatusDetailPathClient', () => ({
  getStatusDetailPathClient: vi.fn(
    async (status: { id: string }) => `/@actor/${status.id}`
  )
}))

vi.mock('@/lib/components/posts/actor', () => ({
  ActorAvatar: () => <div data-testid="actor-avatar" />
}))

vi.mock('@/lib/components/posts/media', () => ({
  Media: () => <div data-testid="media" />
}))

// The MapKit surface is the one map path that is a component rather than an
// imperative GL handle, so it is where a test can read back the instant the
// page is asking the map to highlight.
vi.mock('@/lib/components/fitness/ActivityRouteMapKit', async () => ({
  ActivityRouteMapKit: (await import('./FitnessStatusDetail.mocks'))
    .MockActivityRouteMapKit
}))

vi.mock('@/lib/components/posts/post', async () => ({
  Post: (await import('./FitnessStatusDetail.mocks')).MockPost
}))

vi.mock('@/lib/components/posts/status-reply-box', () => ({
  StatusReplyBox: () => <div data-testid="comment-composer" />
}))

// Stubbed for the same reason `BrandedDeviceLink` is: this page only has to
// open the shared composer in the right mode against the right status and put
// it in the right place. What each mode renders is
// `lib/components/posts/inline-status-composer.test.tsx`'s job.
vi.mock('@/lib/components/posts/inline-status-composer', async () => ({
  InlineStatusComposer: (await import('./FitnessStatusDetail.mocks'))
    .MockInlineStatusComposer
}))

vi.mock('@/lib/components/posts/actions/reply-button', () => ({
  ReplyButton: ({ onReply }: { onReply?: () => void }) => (
    <button type="button" onClick={() => onReply?.()}>
      Reply
    </button>
  )
}))

vi.mock('@/lib/components/posts/actions/repost-button', () => ({
  RepostButton: () => <button type="button">Boost</button>
}))

vi.mock('@/lib/components/posts/actions/like-button', () => ({
  LikeButton: () => <button type="button">Like</button>
}))

vi.mock('@/lib/components/posts/actions/bookmark-button', () => ({
  BookmarkButton: () => <button type="button">Bookmark</button>
}))

// Flattened rather than driven as a real Radix menu; see MockPostMenu.
vi.mock('@/lib/components/posts/actions/post-menu', async () => ({
  PostMenu: (await import('./FitnessStatusDetail.mocks')).MockPostMenu
}))

// Stubbed rather than rendered: this page only has to forward the right props
// to it. Where each of the three renderings actually goes is asserted in
// `lib/components/posts/BrandedDeviceLink.test.tsx`.
vi.mock('@/lib/components/posts/BrandedDeviceLink', async () => ({
  BrandedDeviceLink: (await import('./FitnessStatusDetail.mocks'))
    .MockBrandedDeviceLink
}))

// The inline composer is loaded lazily; preload it so it renders synchronously.
beforeAll(async () => {
  await preloadInlineStatusComposer()
})

describe('FitnessStatusDetail', () => {
  beforeEach(() => {
    resetFitnessStatusDetailMocks()
  })

  it('dates the activity from the recorded start time, not the post time', async () => {
    // A Strava webhook import is stamped when it published rather than when the
    // ride began, and this placeholder is what renders until the by-status
    // fetch lands — which here (the default mock) answers null and never does.
    renderDetail({
      status: buildStatus({
        createdAt: Date.parse('2026-05-27T14:05:00Z'),
        updatedAt: Date.parse('2026-05-27T14:05:00Z'),
        fitness: {
          id: 'fit-1',
          fileName: 'ride.fit',
          fileType: 'fit',
          mimeType: 'application/octet-stream',
          bytes: 2048,
          url: 'https://activities.local/fit/ride.fit',
          processingStatus: 'completed',
          totalDistanceMeters: 5000,
          totalDurationSeconds: 1800,
          elevationGainMeters: 120,
          activityType: 'ride',
          activityStartTime: Date.parse('2026-05-27T10:42:00Z'),
          hasMapData: false
        }
      } as Partial<StatusNote>)
    })

    const activityDate = screen.getByText('10:42 AM, May 27, 2026', {
      exact: false
    })
    expect(activityDate).toBeInTheDocument()
    expect(screen.queryByText('2:05 PM, May 27, 2026')).not.toBeInTheDocument()
    // Rendered through `ActivityStartTime`, which switches to the viewer's own
    // zone after hydration (proved in its own test, which moves the zone).
    expect(activityDate.closest('time')).toHaveAttribute(
      'datetime',
      '2026-05-27T10:42:00.000Z'
    )
  })

  it('fills the overview groups from the stored totals before the route data arrives', async () => {
    // The route data never answers, so everything below comes off the status.
    mockGetFitnessRouteData.mockImplementation(() => new Promise(() => {}))
    renderDetail({
      status: buildStatus({
        fitness: {
          ...buildStatus().fitness,
          avgPower: 215,
          maxPower: 580,
          avgHeartRate: 148,
          maxHeartRate: 172,
          totalWorkKj: 387
        }
      } as Partial<StatusNote>)
    })

    const overview = screen.getByRole('region', { name: 'Overview' })
    expect(
      within(overview).getByText('5.00 km · 30:00 elapsed')
    ).toBeInTheDocument()
    expect(within(overview).getByText('215 / 580 W')).toBeInTheDocument()
    expect(within(overview).getByText('387 kJ')).toBeInTheDocument()
    expect(within(overview).getByText('148 / 172 bpm')).toBeInTheDocument()
    // Route-only figures reserve space when the summary's sensor totals make
    // them likely; their values remain private until the route request resolves.
    const rideGroup = within(overview).getByTestId('overview-group-ride')
    expect(
      within(rideGroup)
        .getAllByTestId('overview-placeholder-row')
        .map((row) => row.getAttribute('data-metric'))
    ).toEqual(['Max speed', 'Calories', 'Laps'])
    const powerGroup = within(overview).getByTestId('overview-group-power')
    expect(
      within(powerGroup)
        .getAllByTestId('overview-placeholder-row')
        .map((row) => row.getAttribute('data-metric'))
    ).toEqual(['Weighted', 'Variability', 'L / R balance'])
    const heartRateGroup = within(overview).getByTestId(
      'overview-group-heart-rate'
    )
    expect(
      within(heartRateGroup)
        .getAllByTestId('overview-placeholder-row')
        .map((row) => row.getAttribute('data-metric'))
    ).toEqual(['Time in Z3–Z4', 'Decoupling'])
    const cadenceGroup = within(overview).getByTestId('overview-group-cadence')
    expect(
      within(cadenceGroup)
        .getAllByTestId('overview-placeholder-row')
        .map((row) => row.getAttribute('data-metric'))
    ).toEqual(['Avg cadence', 'Time at 0 W'])
    expect(
      within(screen.getByRole('region', { name: 'Analysis' }))
        .getAllByTestId('analysis-series-chip-placeholder')
        .map((chip) => chip.getAttribute('data-series'))
    ).toEqual(['elevation', 'speed', 'power', 'heart-rate', 'cadence', 'grade'])
    expect(
      within(screen.getByRole('region', { name: 'Analysis' })).getByTestId(
        'analysis-laps-skeleton'
      )
    ).toBeInTheDocument()
    // The route data is asked for at once: every section reads it.
    expect(mockGetFitnessRouteData).toHaveBeenCalledWith('fit-1')
  })

  it('reserves only sparse overview rows and omits the lap band when the summary has no sensors', () => {
    mockGetFitnessRouteData.mockImplementation(() => new Promise(() => {}))
    const baseStatus = buildStatus()
    renderDetail({
      status: buildStatus({
        fitness: {
          ...baseStatus.fitness,
          fileName: 'vitals-sparse-ride.tcx',
          fileType: 'tcx',
          totalDistanceMeters: 6500,
          totalDurationSeconds: 2100,
          elevationGainMeters: 7,
          elevationSeries: [4, 5, 6, 7, 8, 9, 10, 11],
          avgPower: null,
          maxPower: null,
          avgHeartRate: null,
          maxHeartRate: null,
          totalWorkKj: null
        }
      } as Partial<StatusNote>)
    })

    const overview = screen.getByRole('region', { name: 'Overview' })
    expect(
      within(overview)
        .getAllByTestId('overview-placeholder-row')
        .map((row) => row.getAttribute('data-metric'))
    ).toEqual(['Max speed'])
    for (const group of ['power', 'heart-rate', 'cadence']) {
      expect(
        within(overview).queryByTestId(`overview-group-${group}`)
      ).not.toBeInTheDocument()
    }

    const analysisSection = screen.getByRole('region', { name: 'Analysis' })
    expect(
      within(analysisSection)
        .getAllByTestId('analysis-series-chip-placeholder')
        .map((chip) => chip.getAttribute('data-series'))
    ).toEqual(['elevation', 'speed', 'grade'])
    expect(
      within(analysisSection).queryByTestId('analysis-laps-skeleton')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'Best efforts' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('analysis-distribution-skeleton')
    ).not.toBeInTheDocument()
  })

  it('renders an analysis skeleton sized from summary metrics while route analysis is loading', async () => {
    mockGetFitnessRouteData.mockImplementation(() => new Promise(() => {}))
    renderDetail({
      status: buildStatus({
        fitness: {
          ...buildStatus().fitness,
          avgPower: 215,
          avgHeartRate: 148
        }
      } as Partial<StatusNote>)
    })

    const analysisSection = screen.getByRole('region', {
      name: 'Analysis'
    })
    const loadingRegion = within(analysisSection).getByRole('status', {
      name: 'Loading activity analysis'
    })
    expect(loadingRegion).toBeInTheDocument()
    expect(
      analysisSection.querySelectorAll('[data-slot="frame"]')
    ).toHaveLength(2)
    const bestEffortsSection = screen.getByRole('region', {
      name: 'Best efforts'
    })
    expect(bestEffortsSection).toBeInTheDocument()
    expect(analysisSection).not.toContainElement(bestEffortsSection)
    const distributionSkeleton = screen.getByTestId(
      'analysis-distribution-skeleton'
    )
    expect(analysisSection).not.toContainElement(distributionSkeleton)
    // 3 distribution skeleton frames (1 HR + 2 power)
    expect(
      distributionSkeleton.querySelectorAll('[data-slot="frame"]')
    ).toHaveLength(3)
  })

  it('matches the analysis controls row and responsive plot height while loading', () => {
    mockGetFitnessRouteData.mockImplementation(() => new Promise(() => {}))
    renderDetail()

    const analysisSection = screen.getByRole('region', { name: 'Analysis' })
    expect(
      within(analysisSection).getByTestId('analysis-controls-skeleton')
    ).toBeInTheDocument()
    expect(
      within(analysisSection).getByTestId('analysis-plot-skeleton')
    ).toHaveClass('h-[190px]', '@min-[700px]:h-[250px]')
  })

  it('keeps reserved layout static with em-dash overview rows and a retry overlay when route data fails', async () => {
    mockGetFitnessRouteData.mockRejectedValue(new Error('request failed'))
    renderDetail({
      status: buildStatus({
        attachments: [
          {
            id: 'map',
            type: 'Document',
            name: 'Route map',
            url: 'https://activities.local/map.png',
            mediaType: 'image/png',
            width: 800,
            height: 600
          }
        ],
        fitness: {
          ...buildStatus().fitness,
          hasMapData: true,
          avgPower: 215,
          maxPower: 580,
          avgHeartRate: 148,
          maxHeartRate: 172,
          totalWorkKj: 387
        }
      } as unknown as Partial<StatusNote>)
    })

    const analysisSection = await screen.findByRole('region', {
      name: 'Analysis'
    })
    await within(analysisSection).findByRole('button', { name: 'Retry' })

    const overview = screen.getByRole('region', { name: 'Overview' })
    const rideGroup = within(overview).getByTestId('overview-group-ride')
    expect(within(rideGroup).getByText('Elapsed time')).toBeInTheDocument()
    expect(within(rideGroup).getByText('Avg speed')).toBeInTheDocument()
    expect(within(overview).getByText('215 / 580 W')).toBeInTheDocument()
    expect(within(overview).getByText('387 kJ')).toBeInTheDocument()
    expect(within(overview).getByText('148 / 172 bpm')).toBeInTheDocument()
    expect(
      within(overview).queryByTestId('overview-placeholder-row')
    ).not.toBeInTheDocument()

    const unavailableRows = within(overview).getAllByTestId(
      'overview-unavailable-row'
    )
    expect(
      unavailableRows.map((row) => row.getAttribute('data-metric'))
    ).toEqual([
      'Max speed',
      'Calories',
      'Laps',
      'Weighted',
      'Variability',
      'L / R balance',
      'Time in Z3–Z4',
      'Decoupling',
      'Avg cadence',
      'Time at 0 W'
    ])
    for (const row of unavailableRows) {
      expect(row.querySelector('dd')).toHaveTextContent('—')
      expect(row.querySelector('dd')).toHaveTextContent('Not available')
    }

    const mapAlert = within(overview).getByRole('alert')
    expect(mapAlert).toHaveTextContent(ROUTE_DATA_ERROR_MESSAGE)
    expect(mapAlert).toHaveClass('left-3', 'right-14', 'top-3')
    expect(mapAlert).not.toHaveClass('inset-x-3')

    // The map's banner is the one live alert; the analysis failure overlay is
    // silent when a map is present so a screen reader hears the failure once.
    expect(screen.getAllByRole('alert')).toEqual([mapAlert])
    expect(within(analysisSection).queryByRole('status')).toBeNull()
    expect(
      within(analysisSection).getByText(
        "Couldn't load the charts for this activity"
      )
    ).toBeInTheDocument()
    expect(
      within(analysisSection).getByText(ROUTE_DATA_ERROR_MESSAGE)
    ).toBeInTheDocument()
    expect(
      within(analysisSection).getByRole('button', { name: 'Retry' })
    ).toBeInTheDocument()

    // Reserved frames and placeholders stay mounted with static shimmer so the
    // page keeps its height.
    expect(
      analysisSection.querySelectorAll('[data-slot="frame"]')
    ).toHaveLength(2)
    expect(
      within(analysisSection).getByTestId('analysis-controls-skeleton')
    ).toBeInTheDocument()
    expect(
      within(analysisSection).getByTestId('analysis-laps-skeleton')
    ).toBeInTheDocument()
    expect(
      within(analysisSection).getByTestId('analysis-plot-skeleton')
    ).toBeInTheDocument()
    expect(
      analysisSection.querySelector('.skeleton-static')
    ).toBeInTheDocument()

    const bestEffortsSection = screen.getByRole('region', {
      name: 'Best efforts'
    })
    expect(bestEffortsSection).toHaveClass('skeleton-static')
    const distributionSkeleton = screen.getByTestId(
      'analysis-distribution-skeleton'
    )
    expect(distributionSkeleton).toHaveClass('skeleton-static')
    expect(distributionSkeleton).toHaveAttribute('aria-hidden', 'true')
  })

  it('announces a route-data failure once when the activity has no map', async () => {
    mockGetFitnessRouteData.mockRejectedValue(new Error('request failed'))
    renderDetail()

    const analysisSection = await screen.findByRole('region', {
      name: 'Analysis'
    })
    const alerts = await screen.findAllByRole('alert')
    expect(alerts).toHaveLength(1)
    expect(analysisSection).toContainElement(alerts[0])
    expect(alerts[0]).toHaveTextContent(
      "Couldn't load the charts for this activity"
    )
    expect(alerts[0]).toHaveTextContent(ROUTE_DATA_ERROR_MESSAGE)
    expect(within(analysisSection).queryByRole('status')).toBeNull()
  })

  it.each([
    {
      name: 'a GPX file with power',
      fitness: {
        fileType: 'gpx',
        totalDurationSeconds: 1800,
        avgPower: 215,
        maxPower: 580
      },
      ride: ['Max speed'],
      power: ['Weighted', 'Variability'],
      heartRate: null,
      cadence: ['Time at 0 W'],
      chips: ['elevation', 'speed', 'power', 'grade'],
      hasLapBand: false
    },
    {
      name: 'a zero-second activity',
      fitness: {
        totalDurationSeconds: 0,
        elevationGainMeters: 0,
        avgPower: 215,
        maxPower: 580,
        avgHeartRate: 148,
        maxHeartRate: 172
      },
      ride: ['Max speed'],
      power: ['Weighted', 'Variability', 'L / R balance'],
      heartRate: ['Time in Z3–Z4'],
      cadence: ['Avg cadence', 'Time at 0 W'],
      chips: ['power', 'heart-rate', 'cadence'],
      hasLapBand: false
    },
    {
      name: 'a five-minute activity with power and heart rate',
      fitness: {
        totalDurationSeconds: 300,
        avgPower: 215,
        maxPower: 580,
        avgHeartRate: 148,
        maxHeartRate: 172
      },
      ride: ['Max speed', 'Calories', 'Laps'],
      power: ['Weighted', 'Variability', 'L / R balance'],
      heartRate: ['Time in Z3–Z4'],
      cadence: ['Avg cadence', 'Time at 0 W'],
      chips: ['elevation', 'speed', 'power', 'heart-rate', 'cadence', 'grade'],
      hasLapBand: true
    },
    {
      name: 'a swim with sensors',
      fitness: {
        activityType: 'swim',
        totalDistanceMeters: 1000,
        avgPower: 215,
        maxPower: 580,
        avgHeartRate: 148,
        maxHeartRate: 172
      },
      ride: ['Max speed', 'Calories', 'Laps'],
      power: ['Weighted', 'Variability', 'L / R balance'],
      heartRate: ['Time in Z3–Z4', 'Decoupling'],
      cadence: ['Time at 0 W'],
      chips: ['elevation', 'speed', 'power', 'heart-rate', 'grade'],
      hasLapBand: true
    }
  ])(
    'reserves only the rows the summary supports for $name',
    ({ fitness, ride, power, heartRate, cadence, chips, hasLapBand }) => {
      mockGetFitnessRouteData.mockImplementation(() => new Promise(() => {}))
      renderDetail({
        status: buildStatus({
          fitness: { ...buildStatus().fitness, ...fitness }
        } as unknown as Partial<StatusNote>)
      })

      const overview = screen.getByRole('region', { name: 'Overview' })
      const placeholders = (group: string) => {
        const frame = within(overview).queryByTestId(`overview-group-${group}`)
        return frame
          ? within(frame)
              .queryAllByTestId('overview-placeholder-row')
              .map((row) => row.getAttribute('data-metric'))
          : null
      }
      expect(placeholders('ride')).toEqual(ride)
      expect(placeholders('power')).toEqual(power)
      expect(placeholders('heart-rate')).toEqual(heartRate)
      expect(placeholders('cadence')).toEqual(cadence)

      const analysis = screen.getByRole('region', { name: 'Analysis' })
      expect(
        within(analysis)
          .queryAllByTestId('analysis-series-chip-placeholder')
          .map((chip) => chip.getAttribute('data-series'))
      ).toEqual(chips)
      expect(
        within(analysis).queryByTestId('analysis-laps-skeleton') !== null
      ).toBe(hasLapBand)
    }
  )

  it('leaves out the overview rows the activity has nothing for', async () => {
    renderDetail()

    const overview = screen.getByRole('region', { name: 'Overview' })
    // The fixture has power and heart rate but no cadence or temperature.
    await waitFor(() =>
      expect(within(overview).getByText('Weighted')).toBeInTheDocument()
    )
    expect(within(overview).getByText('Power')).toBeInTheDocument()
    expect(within(overview).getByText('Heart rate')).toBeInTheDocument()
    expect(within(overview).queryByText('Avg cadence')).not.toBeInTheDocument()
    expect(within(overview).queryByText('Temperature')).not.toBeInTheDocument()
    expect(
      within(overview).queryByText('Avg temperature')
    ).not.toBeInTheDocument()
    // Time at 0 W comes from the power series, which the fixture has.
    expect(within(overview).getByText('Time at 0 W')).toBeInTheDocument()
  })

  it('falls back to the static preview when the interactive map never finishes loading', async () => {
    mockGetFitnessFilesByStatus.mockResolvedValue([
      buildFitnessFile({ hasMapData: true })
    ])
    // The GL module loads, but the style/tiles never do, so `load` never fires.
    // Without the load watchdog the panel would sit on an empty container.
    const map = { on: vi.fn(), once: vi.fn(), remove: vi.fn() }
    // Must be a plain function, not an arrow: the component calls `new mapbox.Map()`
    // and an arrow implementation is not constructible (it would throw and take the
    // catch branch, masking whether the watchdog actually fired).
    const MapConstructor = vi.fn(function MapStub() {
      return map
    })
    vi.mocked(loadMaplibreModule).mockResolvedValue({
      Map: MapConstructor
    } as never)

    vi.useFakeTimers()
    try {
      renderDetail()
      // Flush the chained fitness-file -> route-data fetches (each resolves a
      // promise and commits state) so the map effect runs and arms the watchdog.
      for (let flush = 0; flush < 6; flush += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0)
        })
      }
      // The map constructed successfully and nothing has failed yet, so the
      // fallback asserted below can only come from the watchdog — not from the
      // constructor's catch branch.
      expect(MapConstructor).toHaveBeenCalledTimes(1)
      expect(
        screen.queryByText('Interactive map unavailable. Using static preview.')
      ).not.toBeInTheDocument()
      // Deliberately no `error` subscription: GL fires `error` for transient tile
      // and sprite failures, which must not tear down a working map.
      expect(map.on).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000)
      })

      expect(
        screen.getByText('Interactive map unavailable. Using static preview.')
      ).toBeInTheDocument()
      expect(map.remove).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('draws the interactive map in the overview at once, with no Play button', async () => {
    const map = {
      addControl: vi.fn(),
      addLayer: vi.fn(),
      addSource: vi.fn(),
      fitBounds: vi.fn(),
      getCanvas: vi.fn(() => document.createElement('canvas')),
      getSource: vi.fn(() => null),
      on: vi.fn(),
      once: vi.fn(),
      project: vi.fn(() => ({ x: 0, y: 0 })),
      remove: vi.fn(),
      resize: vi.fn(),
      setFeatureState: vi.fn()
    }
    const MapConstructor = vi.fn(function MapStub() {
      return map
    })
    vi.mocked(loadMaplibreModule).mockResolvedValue({
      Map: MapConstructor
    } as never)

    renderDetail({
      status: buildStatus({
        fitness: { ...buildStatus().fitness, hasMapData: true }
      } as Partial<StatusNote>)
    })

    await waitFor(() => expect(MapConstructor).toHaveBeenCalledTimes(1))
    expect(
      screen.queryByRole('button', { name: 'Load interactive route map' })
    ).not.toBeInTheDocument()
    // Sized by aspect ratio (16:9, 4:3 beside the figures) until resized.
    const overview = screen.getByRole('region', { name: 'Overview' })
    expect(overview.querySelector('.aspect-video')).not.toBeNull()
  })

  it('renders the activity header with the type badge and the headline figures', async () => {
    renderDetail()

    const post = screen
      .getByText('Athlete Runner')
      .closest('[data-slot="fitness-card"]') as HTMLElement
    expect(
      within(post).getByText('@athlete@activities.local')
    ).toBeInTheDocument()
    // Type badge derived from the activity type.
    expect(within(post).getByText('Ride')).toBeInTheDocument()
    // The caption renders as normal post content, not a page heading.
    expect(within(post).getByText('Sunset loop')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()

    expect(screen.getByTestId('activity-tile-distance')).toHaveTextContent(
      'Distance5.00km'
    )
    expect(screen.getByTestId('activity-tile-moving-time')).toHaveTextContent(
      'Moving time30:00moving'
    )
    expect(screen.getByTestId('activity-tile-elevation')).toHaveTextContent(
      'Elevation120m gain'
    )
    // Weighted (normalized) power once the file's power series is in.
    await waitFor(() =>
      expect(screen.getByTestId('activity-tile-power')).toHaveTextContent(
        /^Weighted power\d+watts$/
      )
    )
  })

  it('shows the average power in the tile until the file gives weighted power', () => {
    mockGetFitnessRouteData.mockImplementation(() => new Promise(() => {}))
    renderDetail({
      status: buildStatus({
        fitness: { ...buildStatus().fitness, avgPower: 201 }
      } as Partial<StatusNote>)
    })

    expect(screen.getByTestId('activity-tile-power')).toHaveTextContent(
      'Avg power201watts'
    )
  })

  it('shows speed in the fourth tile when there is no power', () => {
    mockGetFitnessRouteData.mockImplementation(() => new Promise(() => {}))
    renderDetail()

    expect(screen.queryByTestId('activity-tile-power')).not.toBeInTheDocument()
    expect(screen.getByTestId('activity-tile-pace')).toHaveTextContent(
      'Avg speed10.0km/h'
    )
  })

  it('fills the strip for an indoor ride with no distance or climbing', () => {
    mockGetFitnessRouteData.mockImplementation(() => new Promise(() => {}))
    renderDetail({
      status: buildStatus({
        fitness: {
          ...buildStatus().fitness,
          activityType: 'virtual_ride',
          totalDistanceMeters: 0,
          elevationGainMeters: 0,
          avgPower: 200,
          avgHeartRate: 141,
          maxHeartRate: 170
        }
      } as Partial<StatusNote>)
    })

    // No "0 m gain" and no distance: heart rate and work take their places.
    expect(
      screen.queryByTestId('activity-tile-elevation')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('activity-tile-distance')
    ).not.toBeInTheDocument()
    expect(
      screen
        .getAllByTestId(/^activity-tile-/)
        .map((tile) => tile.dataset.testid)
    ).toEqual([
      'activity-tile-moving-time',
      'activity-tile-power',
      'activity-tile-heart-rate',
      'activity-tile-work'
    ])
    // 200 W over 30 minutes.
    expect(screen.getByTestId('activity-tile-work')).toHaveTextContent(
      'Work360kJ'
    )
  })

  it('shows two tiles rather than three, which would leave a hole', () => {
    mockGetFitnessRouteData.mockImplementation(() => new Promise(() => {}))
    renderDetail({
      status: buildStatus({
        fitness: {
          ...buildStatus().fitness,
          activityType: 'hike',
          totalDistanceMeters: 0,
          elevationGainMeters: 50,
          avgHeartRate: 141
        }
      } as Partial<StatusNote>)
    })

    // Moving time, elevation and heart rate are three figures; the third
    // would orphan a cell, so the first two show.
    expect(
      screen
        .getAllByTestId(/^activity-tile-/)
        .map((tile) => tile.dataset.testid)
    ).toEqual(['activity-tile-moving-time', 'activity-tile-elevation'])
  })

  it('has no section menu: every section is on the page, with an anchor', async () => {
    renderDetail()

    expect(
      screen.queryByRole('button', { name: /^Overview/ })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('navigation', { name: 'Activity sections' })
    ).not.toBeInTheDocument()
    expect(
      await screen.findByRole('region', { name: 'Analysis' })
    ).toHaveAttribute('id', 'analysis')
    expect(screen.getByRole('region', { name: 'Overview' })).toHaveAttribute(
      'id',
      'overview'
    )
    // No separate photos or comments sections either.
    expect(
      screen.queryByRole('region', { name: 'Photos' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'Comments' })
    ).not.toBeInTheDocument()
  })

  it('shows the heart rate zones once the route data is in', async () => {
    renderDetail()

    expect(
      await screen.findByRole('heading', { name: 'Heart rate zones' })
    ).toBeInTheDocument()
    expect(screen.getByText('Recovery')).toBeInTheDocument()
    expect(screen.getByText('Anaerobic')).toBeInTheDocument()
  })

  it('lists the photos in the post media strip, without the route map image', () => {
    renderDetail({
      status: buildStatus({
        attachments: [
          {
            id: 'map',
            type: 'Document',
            name: 'Route map',
            url: 'https://activities.local/map.png',
            mediaType: 'image/png',
            width: 800,
            height: 600
          },
          {
            id: 'photo',
            type: 'Document',
            name: 'Sunset',
            url: 'https://activities.local/sunset.jpg',
            mediaType: 'image/jpeg',
            width: 800,
            height: 600
          }
        ]
      } as unknown as Partial<StatusNote>)
    })

    const post = screen
      .getByText('Athlete Runner')
      .closest('[data-slot="fitness-card"]') as HTMLElement
    expect(
      within(post).getByRole('button', { name: 'Open media: Sunset' })
    ).toBeInTheDocument()
    expect(
      within(post).queryByRole('button', { name: 'Open media: Route map' })
    ).not.toBeInTheDocument()
  })

  describe('moving time tile', () => {
    const movingTimeValue = () =>
      screen.getByText('Moving time').closest('div')!.parentElement!.textContent

    it('shows the recorded moving time, not the elapsed duration', () => {
      // 30:00 elapsed, 25:00 of it spent moving: the average-speed tile is
      // distance over moving time, so this tile has to be the same span.
      renderDetail({
        initialFitnessFiles: [buildFitnessFile({ movingTimeSeconds: 1500 })]
      })

      expect(movingTimeValue()).toContain('25:00')
      expect(movingTimeValue()).not.toContain('30:00')
    })

    // `getFitnessPaceOrSpeed` falls back on a stored 0 as well as on null, and
    // the tile has to follow it — a 0 would otherwise read "0:00" while the
    // average-speed tile divides by the elapsed time.
    it.each([{ movingTimeSeconds: null }, { movingTimeSeconds: 0 }])(
      'falls back to the elapsed duration when moving time is $movingTimeSeconds',
      ({ movingTimeSeconds }) => {
        renderDetail({
          initialFitnessFiles: [buildFitnessFile({ movingTimeSeconds })]
        })

        expect(movingTimeValue()).toContain('30:00')
      }
    )
  })

  it('renders the caption through the same markup pipeline as the timeline, not flattened to plain text', () => {
    renderDetail({
      status: buildStatus({
        text: '<p>Morning <strong>run</strong> &amp; coffee</p>'
      })
    })

    // A real <strong> element, not a stripped/escaped string — matching how
    // `Post` renders the same caption in the timeline.
    const strong = screen.getByText('run', { selector: 'strong' })
    expect(strong).toBeInTheDocument()
    expect(strong.closest('p')).toHaveTextContent('Morning run & coffee')
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
  })

  it('renders each caption <p>/<br> as real elements instead of one run-on line', () => {
    renderDetail({
      status: buildStatus({
        text: '<p>Bennekom to Dieren ride<br>38.7 km in 1:35:23</p><p>Testing new bibs</p>'
      })
    })

    const paragraphs = screen
      .getByText('Testing new bibs')
      .closest('.markdown-content')?.children

    expect(paragraphs).toHaveLength(2)
    expect(paragraphs?.[0].tagName).toBe('P')
    expect(paragraphs?.[0].querySelector('br')).not.toBeNull()
    // No space between the lines: `<br>` is a real line break, not a text node.
    expect(paragraphs?.[0]).toHaveTextContent(
      'Bennekom to Dieren ride38.7 km in 1:35:23'
    )
    expect(paragraphs?.[1]).toHaveTextContent('Testing new bibs')
  })

  it.each([
    { description: 'whitespace-only caption', text: '   ' },
    { description: 'caption that is empty markup', text: '<p></p>' },
    { description: 'caption that is only a line break', text: '<br>' }
  ])(
    'renders no caption content, and no fallback heading, for an empty caption ($description)',
    ({ text }) => {
      renderDetail({ status: buildStatus({ text }) })

      expect(
        screen.queryByRole('heading', { level: 1 })
      ).not.toBeInTheDocument()
      const post = screen
        .getByText('Athlete Runner')
        .closest('[data-slot="fitness-card"]') as HTMLElement
      expect(within(post).getByText('Ride')).toBeInTheDocument()
    }
  )

  describe('replies', () => {
    const buildReply = (id: string) =>
      ({
        id,
        type: 'Note',
        actorId: actor.id,
        actor,
        reply: buildStatus().id
      }) as unknown as Status

    afterEach(() => {
      window.localStorage.clear()
    })

    it('lists the replies inside the post frame, under the action row, open by default', () => {
      renderDetail({ replies: [buildReply('reply-1')] })

      const post = screen
        .getByText('Athlete Runner')
        .closest('[data-slot="fitness-card"]') as HTMLElement
      const toggle = within(post).getByRole('button', { name: /Replies \(1\)/ })
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(toggle).toHaveTextContent('Hide')
      expect(within(post).getByTestId('reply-post')).toHaveTextContent(
        'reply-1'
      )
      // No boosts / likes / replies count strip and no separate comments box.
      expect(screen.queryByText('Boosts')).not.toBeInTheDocument()
      expect(screen.queryByTestId('comment-composer')).not.toBeInTheDocument()
    })

    it('hides and shows the list, and remembers the choice for the site', () => {
      const { unmount } = renderDetail({ replies: [buildReply('reply-1')] })

      fireEvent.click(screen.getByRole('button', { name: /Replies \(1\)/ }))

      const toggle = screen.getByRole('button', { name: /Replies \(1\)/ })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(toggle).toHaveTextContent('Show')
      expect(screen.getByTestId('reply-post')).not.toBeVisible()
      expect(window.localStorage.getItem(REPLIES_EXPANDED_STORAGE_KEY)).toBe(
        '0'
      )

      unmount()
      renderDetail({ replies: [buildReply('reply-1')] })
      expect(
        screen.getByRole('button', { name: /Replies \(1\)/ })
      ).toHaveAttribute('aria-expanded', 'false')
    })

    it('still works when storage is blocked', () => {
      const getItem = vi
        .spyOn(Storage.prototype, 'getItem')
        .mockImplementation(() => {
          throw new Error('blocked')
        })
      const setItem = vi
        .spyOn(Storage.prototype, 'setItem')
        .mockImplementation(() => {
          throw new Error('blocked')
        })
      try {
        renderDetail({ replies: [buildReply('reply-1')] })
        const toggle = screen.getByRole('button', { name: /Replies \(1\)/ })
        expect(toggle).toHaveAttribute('aria-expanded', 'true')
        fireEvent.click(toggle)
        expect(toggle).toHaveAttribute('aria-expanded', 'false')
      } finally {
        getItem.mockRestore()
        setItem.mockRestore()
      }
    })

    it('opens the reply composer at the top of the replies and re-opens a hidden list', async () => {
      renderDetail({ replies: [buildReply('reply-1')] })
      fireEvent.click(screen.getByRole('button', { name: /Replies \(1\)/ }))

      fireEvent.click(screen.getByRole('button', { name: 'Reply' }))

      expect(
        screen.getByRole('button', { name: /Replies \(1\)/ })
      ).toHaveAttribute('aria-expanded', 'true')
      const composer = await screen.findByTestId('inline-status-composer')
      expect(composer).toHaveAttribute('data-mode', 'reply')
      expect(composer).toHaveAttribute('data-status-id', buildStatus().id)
      // Above the first reply.
      expect(
        composer.compareDocumentPosition(screen.getByTestId('reply-post')) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    })

    it('shows five replies, then loads more on request', () => {
      const replies = Array.from({ length: 7 }, (_, index) =>
        buildReply(`reply-${index + 1}`)
      )
      renderDetail({ replies })

      expect(screen.getAllByTestId('reply-post')).toHaveLength(5)
      fireEvent.click(screen.getByRole('button', { name: 'Load more replies' }))
      expect(screen.getAllByTestId('reply-post')).toHaveLength(7)
      expect(
        screen.queryByRole('button', { name: 'Load more replies' })
      ).not.toBeInTheDocument()
    })

    it('says there are no replies yet, with no header, when there are none', () => {
      renderDetail({ replies: [] })

      expect(screen.getByText('No replies yet')).toBeInTheDocument()
      expect(screen.getByText('Be the first to reply.')).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /Replies \(/ })
      ).not.toBeInTheDocument()
    })

    it('puts the composer in place of the empty state while replying', () => {
      renderDetail({ replies: [] })

      fireEvent.click(screen.getByRole('button', { name: 'Reply' }))

      expect(screen.getByTestId('inline-status-composer')).toHaveAttribute(
        'data-mode',
        'reply'
      )
      expect(screen.queryByText('No replies yet')).not.toBeInTheDocument()
    })

    it('gives a logged-out viewer the read-only list and no composer', () => {
      renderDetail({ currentActor: null, replies: [buildReply('reply-1')] })

      expect(screen.getByTestId('reply-post')).toHaveTextContent('reply-1')
      expect(
        screen.queryByRole('button', { name: 'Reply' })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByTestId('inline-status-composer')
      ).not.toBeInTheDocument()
    })

    it('shows a logged-out viewer the reply, boost and like counts in place of the action row', () => {
      renderDetail({ currentActor: null, replies: [buildReply('reply-1')] })

      const engagement = screen.getByRole('group', { name: 'Engagement' })
      expect(
        within(engagement)
          .getAllByText(/^\d+$/)
          .map((node) => node.textContent)
      ).toEqual(['1', '2', '4'])
      expect(
        engagement.closest('[data-slot="fitness-card"]')
      ).toBeInTheDocument()
    })

    it('gives a signed-in viewer the action row and no read-only counts', () => {
      renderDetail({ replies: [buildReply('reply-1')] })

      expect(
        screen.queryByRole('group', { name: 'Engagement' })
      ).not.toBeInTheDocument()
    })

    it('tells a logged-out viewer with no replies where they will show up', () => {
      renderDetail({ currentActor: null, replies: [] })

      expect(screen.getByText('Replies show up here.')).toBeInTheDocument()
    })

    it('navigates to reply status detail when reply openStatus is triggered', async () => {
      renderDetail({ replies: [buildReply('reply-1')] })

      fireEvent.click(screen.getByTestId('open-reply-reply-1'))

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/@actor/reply-1')
      })
    })
  })

  describe('multi-file recording picker', () => {
    const renderAggregatedFiles = () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([
        buildFitnessFile({
          id: 'fit-1',
          fileName: 'ride-morning.fit',
          totalDistanceMeters: 5000
        }),
        buildFitnessFile({
          id: 'fit-2',
          fileName: 'ride-evening.fit',
          isPrimary: false,
          totalDistanceMeters: 12_500,
          activityStartTime: Date.parse('2026-05-27T18:00:00Z')
        })
      ])

      renderDetail()
    }

    it('replaces the Activity file card with a picker in the "Recorded with" line', async () => {
      renderAggregatedFiles()

      const trigger = await screen.findByRole('button', {
        name: recordingTriggerName('ride-morning.fit')
      })
      // The picker is part of the activity card's own "Recorded with" line,
      // not a card of its own.
      const activityCard = trigger.closest(
        '[data-slot="fitness-card"]'
      ) as HTMLElement
      expect(activityCard).toContainElement(screen.getByText('Recorded with'))
      expect(screen.queryByText('Activity file')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Activity file')).not.toBeInTheDocument()
      expect(screen.queryByText(/^file \d+ of \d+$/)).not.toBeInTheDocument()
    })

    it('lists one row per recording under a "Recordings" header, current one marked', async () => {
      renderAggregatedFiles()

      const menu = await openRecordingPicker('ride-morning.fit')

      expect(within(menu).getByText('Recordings')).toBeInTheDocument()
      expect(getRecordingRow(menu, 'ride-morning.fit')).toHaveAttribute(
        'aria-current',
        'true'
      )
      expect(getRecordingRow(menu, 'ride-evening.fit')).not.toHaveAttribute(
        'aria-current'
      )
    })

    it('switches the shown recording when another row is picked', async () => {
      renderAggregatedFiles()
      expect(await screen.findByText('5.00')).toBeInTheDocument()

      await chooseRecording('ride-morning.fit', 'ride-evening.fit')

      expect(
        await screen.findByRole('button', {
          name: recordingTriggerName('ride-evening.fit')
        })
      ).toBeInTheDocument()
      // The stat grid follows the selected recording.
      expect(await screen.findByText('12.5')).toBeInTheDocument()
    })
  })

  it('shows no recording picker for a status with a single fitness file', async () => {
    mockGetFitnessFilesByStatus.mockResolvedValue([
      buildFitnessFile({ id: 'fit-1', fileName: 'ride-morning.fit' })
    ])

    renderDetail()

    // Positive anchor first: the caption is what the loaded status renders, so
    // the absences below are not just "the files have not arrived yet".
    expect(await screen.findByText('Sunset loop')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: recordingTriggerName('ride-morning.fit')
      })
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Activity file')).not.toBeInTheDocument()
    expect(screen.queryByText(/^file \d+ of \d+$/)).not.toBeInTheDocument()
    // Nor a source-file row in the footer: the download is the owner's button
    // beside the device line, and a visitor gets nothing at all.
    expect(screen.queryByText('ride-morning.fit')).not.toBeInTheDocument()
  })
})
