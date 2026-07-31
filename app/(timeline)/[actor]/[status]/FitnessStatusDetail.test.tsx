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
  type FitnessRouteDataResponse,
  type StatusFitnessFileItem,
  getFitnessFilesByStatus,
  getFitnessRouteData
} from '@/lib/client'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusNote } from '@/lib/types/domain/status'
import { loadMaplibreModule } from '@/lib/utils/maplibre'

import { FitnessStatusDetail } from './FitnessStatusDetail'

vi.mock('@/lib/client', () => ({
  getFitnessFilesByStatus: vi.fn(),
  getFitnessRouteData: vi.fn()
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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() })
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
vi.mock('@/lib/components/fitness/ActivityRouteMapKit', () => ({
  ActivityRouteMapKit: ({
    highlightedElapsedSeconds
  }: {
    highlightedElapsedSeconds?: number | null
  }) => (
    <div
      data-testid="route-map"
      data-highlighted-elapsed-seconds={
        typeof highlightedElapsedSeconds === 'number'
          ? String(highlightedElapsedSeconds)
          : ''
      }
    />
  )
}))

vi.mock('@/lib/components/posts/post', () => ({
  Post: ({ status }: { status: { id: string } }) => (
    <div data-testid="reply-post">{status.id}</div>
  )
}))

vi.mock('@/lib/components/posts/status-reply-box', () => ({
  StatusReplyBox: () => <div data-testid="comment-composer" />
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

vi.mock('@/lib/components/posts/actions/post-menu', () => ({
  PostMenu: () => <button type="button">More</button>
}))

vi.mock('@/lib/components/posts/BrandedDeviceLink', () => ({
  BrandedDeviceLink: () => <span>device</span>
}))

const mockGetFitnessFilesByStatus = vi.mocked(getFitnessFilesByStatus)
const mockGetFitnessRouteData = vi.mocked(getFitnessRouteData)

const actor = {
  id: 'https://activities.local/users/athlete',
  username: 'athlete',
  domain: 'activities.local',
  name: 'Athlete Runner'
} as unknown as ActorProfile

// A signed-in reader who is not the athlete.
const notMe = {
  id: 'https://activities.local/users/spectator',
  username: 'spectator',
  domain: 'activities.local',
  name: 'Spectator'
} as unknown as ActorProfile

const buildStatus = (overrides: Partial<StatusNote> = {}): StatusNote =>
  ({
    id: 'https://activities.local/users/athlete/statuses/ride-1',
    actorId: actor.id,
    actor,
    type: 'Note',
    url: 'https://activities.local/@athlete/ride-1',
    text: 'Sunset loop',
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [],
    edits: [],
    isLocalActor: true,
    reply: '',
    replies: [],
    actorAnnounceStatusId: null,
    isActorLiked: false,
    isActorBookmarked: false,
    totalLikes: 4,
    totalShares: 2,
    attachments: [],
    tags: [],
    createdAt: Date.parse('2026-05-27T10:42:00Z'),
    updatedAt: Date.parse('2026-05-27T10:42:00Z'),
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
      hasMapData: false
    },
    ...overrides
  }) as unknown as StatusNote

const buildReactedStatus = (): StatusNote =>
  buildStatus({
    reactions: [
      { name: '\u{1F525}', count: 3, me: false, url: null, static_url: null }
    ]
  } as Partial<StatusNote>)

const routeData: FitnessRouteDataResponse = {
  samples: [
    { lat: 13.7, lng: 100.5, elapsedSeconds: 0 },
    { lat: 13.71, lng: 100.51, elapsedSeconds: 900 },
    { lat: 13.72, lng: 100.52, elapsedSeconds: 1800 }
  ],
  totalDurationSeconds: 1800,
  powerSeries: [120, 150, 180, 210, 90, 60],
  heartRateSeries: [110, 130, 150, 165, 175, 140],
  altitudeSeries: [10, 24, 40, 55, 48, 30],
  speedSeries: [18, 22, 25, 28, 20, 16]
}

// A route split into a visible leg and a privacy-hidden leg, so the map panel
// renders the green-segment notice.
const routeDataWithHiddenSegments: FitnessRouteDataResponse = {
  ...routeData,
  segments: [
    { isHiddenByPrivacy: false, samples: routeData.samples.slice(0, 2) },
    { isHiddenByPrivacy: true, samples: routeData.samples.slice(1) }
  ]
}

const buildFitnessFile = (
  overrides: Partial<StatusFitnessFileItem> = {}
): StatusFitnessFileItem => ({
  id: 'fit-1',
  actorId: actor.id,
  fileName: 'ride.fit',
  fileType: 'fit',
  statusId: 'https://activities.local/users/athlete/statuses/ride-1',
  isPrimary: true,
  processingStatus: 'completed',
  totalDistanceMeters: 5000,
  totalDurationSeconds: 1800,
  elevationGainMeters: 120,
  activityType: 'ride',
  activityStartTime: Date.parse('2026-05-27T10:42:00Z'),
  hasMapData: false,
  description: null,
  deviceManufacturer: null,
  deviceName: null,
  sourceUrl: null,
  ...overrides
})

const renderDetail = (
  props: Partial<Parameters<typeof FitnessStatusDetail>[0]> = {}
) =>
  render(
    <FitnessStatusDetail
      host="activities.local"
      mapProvider={{ type: 'osm' }}
      currentTime={Date.parse('2026-05-27T12:00:00Z')}
      currentActor={actor}
      status={buildStatus()}
      onShowAttachment={vi.fn()}
      {...props}
    />
  )

const openSectionMenu = async () => {
  fireEvent.keyDown(screen.getByRole('button', { name: /Overview/ }), {
    key: 'ArrowDown'
  })
  return screen.findByRole('menu')
}

describe('FitnessStatusDetail', () => {
  beforeEach(() => {
    mockGetFitnessFilesByStatus.mockReset()
    mockGetFitnessRouteData.mockReset()
    mockGetFitnessFilesByStatus.mockResolvedValue(null)
    mockGetFitnessRouteData.mockResolvedValue(routeData)
    // Default: the GL loader never settles, so the map stays initializing.
    vi.mocked(loadMaplibreModule).mockImplementation(
      () => new Promise(() => {})
    )
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

  it('renders the activity header with the type badge, title and primary stats', async () => {
    renderDetail()

    expect(screen.getByText('Athlete Runner')).toBeInTheDocument()
    expect(screen.getByText('@athlete@activities.local')).toBeInTheDocument()
    // Type badge derived from the activity type.
    expect(screen.getByText('Ride')).toBeInTheDocument()
    // Status caption becomes the activity title.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Sunset loop' })
    ).toBeInTheDocument()
    // Primary stat strip.
    expect(screen.getByText('Distance')).toBeInTheDocument()
    expect(screen.getByText('5.00')).toBeInTheDocument()
    expect(screen.getByText('Moving time')).toBeInTheDocument()
    expect(screen.getByText('30:00')).toBeInTheDocument()

    // The secondary Overview stats derive from the loaded route series.
    await waitFor(() => expect(screen.getByText('Avg HR')).toBeInTheDocument())
  })

  it('renders the caption as plain text, stripping HTML tags and decoding entities', () => {
    renderDetail({
      status: buildStatus({
        text: '<p>Morning <strong>run</strong> &amp; coffee</p>'
      })
    })

    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent('Morning run & coffee')
    // No raw markup leaks into the heading text or its title attribute.
    expect(heading.textContent).toBe('Morning run & coffee')
    expect(heading).toHaveAttribute('title', 'Morning run & coffee')
  })

  // These inputs all reduce to empty text, so the heading must fall back to the
  // activity label. The markup cases ('<p></p>', '<br>') are load-bearing: the
  // previous `status.text?.trim()` kept them (truthy) and rendered raw markup,
  // whereas `htmlToPlainText` collapses them to '' and triggers the fallback.
  it.each([
    { description: 'whitespace-only caption', text: '   ' },
    { description: 'caption that is empty markup', text: '<p></p>' },
    { description: 'caption that is only a line break', text: '<br>' }
  ])(
    'falls back to the activity label when the caption has no text ($description)',
    ({ text }) => {
      renderDetail({ status: buildStatus({ text }) })

      expect(
        screen.getByRole('heading', { level: 1, name: 'Ride' })
      ).toBeInTheDocument()
    }
  )

  it('switches to the heart rate zones section from the sub-navigation', async () => {
    renderDetail()

    // Wait for the route data so the heart-rate zones tab is offered.
    await waitFor(() => expect(screen.getByText('Avg HR')).toBeInTheDocument())

    const menu = await openSectionMenu()
    fireEvent.click(
      within(menu).getByRole('menuitem', { name: 'Heart rate zones' })
    )

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Heart rate zones' })
      ).toBeInTheDocument()
    )
    expect(screen.getByText('Recovery')).toBeInTheDocument()
    expect(screen.getByText('Anaerobic')).toBeInTheDocument()
  })

  it('opens the comments section with the composer and replies when the reply action is used', async () => {
    const reply = {
      id: 'reply-1',
      type: 'Note',
      actorId: actor.id,
      actor
    } as unknown as Status

    renderDetail({ replies: [reply] })

    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))

    expect(screen.getByTestId('comment-composer')).toBeInTheDocument()
    expect(screen.getByTestId('reply-post')).toHaveTextContent('reply-1')
  })

  it('omits the comments tab for logged-out viewers with no replies', async () => {
    renderDetail({ currentActor: null, replies: [] })

    await waitFor(() => expect(screen.getByText('Avg HR')).toBeInTheDocument())

    const menu = await openSectionMenu()
    expect(
      within(menu).queryByRole('menuitem', { name: 'Comments' })
    ).not.toBeInTheDocument()
    // The action bar is also hidden for logged-out viewers.
    expect(
      screen.queryByRole('button', { name: 'Reply' })
    ).not.toBeInTheDocument()
  })

  it('renders the read-only comments thread for a logged-out viewer with replies', async () => {
    const reply = {
      id: 'reply-1',
      type: 'Note',
      actorId: actor.id,
      actor
    } as unknown as Status

    renderDetail({ currentActor: null, replies: [reply] })

    await waitFor(() => expect(screen.getByText('Avg HR')).toBeInTheDocument())

    const menu = await openSectionMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Comments' }))

    await waitFor(() =>
      expect(screen.getByTestId('reply-post')).toHaveTextContent('reply-1')
    )
    // No composer for logged-out viewers.
    expect(screen.queryByTestId('comment-composer')).not.toBeInTheDocument()
  })

  it('renders the 25 W power distribution section', async () => {
    const { container } = renderDetail()

    await waitFor(() => expect(screen.getByText('Avg HR')).toBeInTheDocument())

    const menu = await openSectionMenu()
    fireEvent.click(
      within(menu).getByRole('menuitem', { name: '25 W Distribution' })
    )

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Power distribution' })
      ).toBeInTheDocument()
    )
    // Weighted-average power = mean(powerSeries) = 135 W.
    expect(screen.getByText(/Average Power\s*135\s*W/)).toBeInTheDocument()
    expect(container.querySelectorAll('rect').length).toBeGreaterThan(0)
  })

  it('toggles a series off with its picker chip and keeps the rest', async () => {
    renderDetail()

    await waitFor(() => expect(screen.getByText('Avg HR')).toBeInTheDocument())

    const menu = await openSectionMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Analysis' }))

    // A picker chip appears for every available series, all selected by default.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Elevation' })
      ).toBeInTheDocument()
    )
    for (const name of ['Elevation', 'Speed', 'Power', 'Heart rate']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    }
    // Every series is stacked by default.
    expect(
      screen.getByRole('heading', { name: 'Elevation profile' })
    ).toBeInTheDocument()

    // Toggling a chip off drops that graph and leaves the others in place.
    fireEvent.click(screen.getByRole('button', { name: 'Power' }))
    expect(screen.getByRole('button', { name: 'Power' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    expect(
      screen.queryByRole('heading', { name: 'Power' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Elevation profile' })
    ).toBeInTheDocument()
  })

  describe('analysis graphs', () => {
    const openAnalysis = async () => {
      renderDetail()
      await waitFor(() =>
        expect(screen.getByText('Avg HR')).toBeInTheDocument()
      )
      const menu = await openSectionMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Analysis' }))
      return screen.findByTestId('analysis-graphs')
    }

    // jsdom lays nothing out, so every chart reports a zero-size box and the
    // pointer ratio saturates at 1 wherever you "move" to — which cannot tell a
    // correct mapping from a handler that always reports the end of the
    // activity. Give the plot a real box so the offset, the division and the
    // clamp are all exercised.
    const hoverChart = (panel: HTMLElement, clientX: number) => {
      const [elevationChart] = Array.from(panel.querySelectorAll('svg'))
      elevationChart.getBoundingClientRect = () =>
        ({ left: 100, width: 400 }) as DOMRect
      fireEvent.mouseMove(elevationChart, { clientX })
      return elevationChart
    }

    it('stacks every visible graph into one panel instead of separate cards', async () => {
      const panel = await openAnalysis()

      expect(
        within(panel)
          .getAllByRole('heading', { level: 3 })
          .map((heading) => heading.textContent)
      ).toEqual(['Elevation profile', 'Speed', 'Power', 'Heart rate'])
      // Each row is flush: the border and the rounding belong to the shared
      // panel. None of this is observable in jsdom, and without it the stack
      // silently goes back to four separately bordered cards.
      expect(panel).toHaveClass('overflow-hidden', 'rounded-xl', 'border')
      expect(panel.querySelectorAll('.rounded-xl')).toHaveLength(0)
    })

    it('keeps the single panel when only one graph is selected', async () => {
      const panel = await openAnalysis()

      // Toggle every series off except Speed.
      fireEvent.click(screen.getByRole('button', { name: 'Elevation' }))
      fireEvent.click(screen.getByRole('button', { name: 'Power' }))
      fireEvent.click(screen.getByRole('button', { name: 'Heart rate' }))

      expect(within(panel).getAllByRole('heading', { level: 3 })).toHaveLength(
        1
      )
      expect(
        within(panel).getByRole('heading', { name: 'Speed' })
      ).toBeInTheDocument()
    })

    it('overlays the selected series in one chart in combined mode', async () => {
      await openAnalysis()

      fireEvent.click(screen.getByRole('button', { name: 'Combined' }))

      const combined = await screen.findByTestId('analysis-combined-graph')
      // The stacked panel is replaced by one overlaid chart titled "Combined".
      expect(screen.queryByTestId('analysis-graphs')).not.toBeInTheDocument()
      expect(
        within(combined).getByRole('heading', { name: 'Combined' })
      ).toBeInTheDocument()
      expect(
        within(combined).getAllByRole('heading', { level: 3 })
      ).toHaveLength(1)
      // One line per selected series is drawn in the single plot.
      expect(combined.querySelectorAll('svg path')).toHaveLength(4)
      expect(
        within(combined).getByText('Each graph is scaled to its own range.')
      ).toBeInTheDocument()
    })

    it('drops a deselected series from the combined chart', async () => {
      await openAnalysis()

      fireEvent.click(screen.getByRole('button', { name: 'Combined' }))
      const combined = await screen.findByTestId('analysis-combined-graph')
      expect(combined.querySelectorAll('svg path')).toHaveLength(4)

      // Toggling Elevation off removes its overlaid line.
      fireEvent.click(screen.getByRole('button', { name: 'Elevation' }))
      expect(combined.querySelectorAll('svg path')).toHaveLength(3)
    })

    it('reads out every series at once while the combined chart is hovered', async () => {
      await openAnalysis()

      fireEvent.click(screen.getByRole('button', { name: 'Combined' }))
      const combined = await screen.findByTestId('analysis-combined-graph')

      expect(
        screen.queryByTestId('combined-hover-value')
      ).not.toBeInTheDocument()

      const [plot] = Array.from(combined.querySelectorAll('svg'))
      plot.getBoundingClientRect = () => ({ left: 100, width: 400 }) as DOMRect
      // A quarter of the way across => 450s of a 1800s ride.
      fireEvent.mouseMove(plot, { clientX: 200 })

      const readout = screen.getByTestId('combined-hover-value')
      // One box, with a value + unit row for every selected series.
      expect(within(readout).getAllByText(/^(m|km\/h|w|bpm)$/)).toHaveLength(4)
      expect(screen.getByText('Selected time: 7:30')).toBeInTheDocument()
      // A dot pinned to each series' own line at that instant.
      expect(screen.getAllByTestId('combined-hover-dot')).toHaveLength(4)

      fireEvent.mouseLeave(plot)
      expect(
        screen.queryByTestId('combined-hover-value')
      ).not.toBeInTheDocument()
    })

    it('shows a hint when every graph is toggled off', async () => {
      await openAnalysis()

      for (const name of ['Elevation', 'Speed', 'Power', 'Heart rate']) {
        fireEvent.click(screen.getByRole('button', { name }))
      }

      expect(screen.queryByTestId('analysis-graphs')).not.toBeInTheDocument()
      expect(
        screen.getByText('Select at least one graph to display.')
      ).toBeInTheDocument()
    })

    it('keeps a deselected series out after switching display modes', async () => {
      await openAnalysis()

      // Deselect Elevation in the default separate mode.
      fireEvent.click(screen.getByRole('button', { name: 'Elevation' }))
      expect(
        screen.queryByRole('heading', { name: 'Elevation profile' })
      ).not.toBeInTheDocument()

      // The selection is independent of the mode: switching to combined keeps
      // Elevation out, so only three of the four series overlay.
      fireEvent.click(screen.getByRole('button', { name: 'Combined' }))
      const combined = await screen.findByTestId('analysis-combined-graph')
      expect(screen.getByRole('button', { name: 'Elevation' })).toHaveAttribute(
        'aria-pressed',
        'false'
      )
      expect(combined.querySelectorAll('svg path')).toHaveLength(3)

      // …and back again: still out in the separate stack.
      fireEvent.click(screen.getByRole('button', { name: 'Separate' }))
      const panel = await screen.findByTestId('analysis-graphs')
      expect(within(panel).getAllByRole('heading', { level: 3 })).toHaveLength(
        3
      )
      expect(
        within(panel).queryByRole('heading', { name: 'Elevation profile' })
      ).not.toBeInTheDocument()
    })

    it('offers no chip for a series that has no data', async () => {
      // A file with no power stream: the Power chip never appears, and the
      // combined chart overlays only the three series that do have data. This
      // guards the availability filter that replaced the removed reset effect —
      // a selected-but-absent series simply drops out, it never gets stuck.
      mockGetFitnessRouteData.mockResolvedValue({
        ...routeData,
        powerSeries: []
      })

      await openAnalysis()

      expect(
        screen.queryByRole('button', { name: 'Power' })
      ).not.toBeInTheDocument()
      for (const name of ['Elevation', 'Speed', 'Heart rate']) {
        expect(screen.getByRole('button', { name })).toBeInTheDocument()
      }

      fireEvent.click(screen.getByRole('button', { name: 'Combined' }))
      const combined = await screen.findByTestId('analysis-combined-graph')
      expect(combined.querySelectorAll('svg path')).toHaveLength(3)
    })

    it('explains the overlay in combined mode', async () => {
      await openAnalysis()

      fireEvent.click(screen.getByRole('button', { name: 'Combined' }))

      expect(
        await screen.findByText(
          'Pick the graphs to overlay in one chart. Hover it to follow that time point on the map.'
        )
      ).toBeInTheDocument()
    })

    it('shows a value readout on every graph while one is hovered', async () => {
      const panel = await openAnalysis()

      expect(screen.queryAllByTestId('chart-hover-value')).toHaveLength(0)

      // A quarter of the way across => 450s of a 1800s ride => sample index 1.
      const elevationChart = hoverChart(panel, 200)

      // Hovering one graph highlights the same instant on all of them, so each
      // reports its own value at that time.
      const readouts = screen.getAllByTestId('chart-hover-value')
      expect(readouts).toHaveLength(4)
      expect(readouts.map((readout) => readout.textContent)).toEqual([
        '24m',
        '22.0km/h',
        '150w',
        '130bpm'
      ])
      expect(screen.getByText('Selected time: 7:30')).toBeInTheDocument()

      fireEvent.mouseLeave(elevationChart)
      expect(screen.queryAllByTestId('chart-hover-value')).toHaveLength(0)
    })

    it('marks the highlighted point in each series own colour', async () => {
      const panel = await openAnalysis()

      hoverChart(panel, 200)

      // Every crosshair used to share the speed chart's blue, which made a
      // stacked graph unidentifiable by its own colour.
      expect(
        screen
          .getAllByTestId('chart-hover-dot')
          .map((dot) => dot.getAttribute('class'))
      ).toEqual([
        expect.stringContaining('bg-slate-400'),
        expect.stringContaining('bg-sky-500'),
        expect.stringContaining('bg-violet-500'),
        expect.stringContaining('bg-rose-500')
      ])
      // HTML, not an SVG `circle`: under `preserveAspectRatio="none"` a circle
      // renders as an ellipse whose shape changes with the column width.
      expect(panel.querySelectorAll('circle')).toHaveLength(0)
    })

    it('keeps the heart-rate time axis aligned across a sensor dropout', async () => {
      // The strap picks up only halfway in. Dropping those samples instead of
      // holding the first real reading would compact the series and slide the
      // whole heart-rate axis left, so the readout would report an instant the
      // other three graphs are not showing.
      mockGetFitnessRouteData.mockResolvedValue({
        ...routeData,
        heartRateSeries: [0, 0, 0, 120, 140, 160]
      })

      const panel = await openAnalysis()
      hoverChart(panel, 200)

      const readouts = screen.getAllByTestId('chart-hover-value')
      expect(readouts.map((readout) => readout.textContent)).toEqual([
        '24m',
        '22.0km/h',
        '150w',
        // Index 1 of the held series [120,120,120,120,140,160] — still the
        // reading for 7:30, not the second POSITIVE sample (140).
        '120bpm'
      ])
    })

    it('reports a value that rounds to zero without a negative sign', async () => {
      // A downsampled elevation bin straddling sea level averages just below
      // zero, and `toFixed` keeps the sign: the readout used to read "-0 m".
      mockGetFitnessRouteData.mockResolvedValue({
        ...routeData,
        altitudeSeries: [10, -0.3, 40, 55, 48, 30]
      })

      const panel = await openAnalysis()

      // Every number the chart prints comes off the same bins, so the scale
      // labels need the guard as much as the readout does — fixing only the
      // readout left this exact fixture rendering "Scale -0 m - 55 m" beside a
      // readout that said "0 m".
      expect(within(panel).getByText(/^Scale 0 m - 55 m$/)).toBeInTheDocument()
      expect(within(panel).getAllByText('0 m').length).toBeGreaterThan(0)
      expect(within(panel).queryByText(/-0 m/)).not.toBeInTheDocument()

      hoverChart(panel, 200)

      expect(screen.getAllByTestId('chart-hover-value')[0]).toHaveTextContent(
        /^0m$/
      )
    })

    it('scrubs on touch as well as on hover', async () => {
      const panel = await openAnalysis()
      const [elevationChart] = Array.from(panel.querySelectorAll('svg'))
      elevationChart.getBoundingClientRect = () =>
        ({ left: 100, width: 400 }) as DOMRect

      // A phone has no hover, so without touch handlers the readout is simply
      // unreachable there — and the charts carry their own mobile height.
      fireEvent.touchStart(elevationChart, {
        touches: [{ clientX: 200 }]
      })

      expect(
        screen.getAllByTestId('chart-hover-value').map((r) => r.textContent)
      ).toEqual(['24m', '22.0km/h', '150w', '130bpm'])

      fireEvent.touchEnd(elevationChart)
      expect(screen.queryAllByTestId('chart-hover-value')).toHaveLength(0)
    })

    it('leaves the browser both page scrolling and pinch zoom', async () => {
      const panel = await openAnalysis()

      // Only the horizontal drag is claimed. `touch-pan-y` alone compiles to
      // exactly `touch-action: pan-y`, which silently drops pinch-zoom over a
      // stack of four charts — so the second class is load-bearing, not
      // decorative.
      for (const chart of Array.from(panel.querySelectorAll('svg'))) {
        expect(chart).toHaveClass('touch-pan-y')
        expect(chart).toHaveClass('touch-pinch-zoom')
      }
    })

    it('suppresses the compatibility mouse events a tap fires afterwards', async () => {
      const panel = await openAnalysis()
      const [elevationChart] = Array.from(panel.querySelectorAll('svg'))

      // A tap is followed by a compat `mousemove` at the same point, which
      // would re-enter the scrub the instant `touchend` clears it and leave the
      // readout stuck on — no `mouseleave` ever follows a touch. Preventing the
      // default is what suppresses that sequence, and `fireEvent` returns false
      // exactly when a cancelable event was cancelled. (`touchEnd` is cancelable
      // by default in @testing-library/dom's event map.)
      expect(fireEvent.touchEnd(elevationChart)).toBe(false)
    })

    it('flips the readout before it can overflow a narrow plot', async () => {
      // Eleven samples put a hover point at exactly 0.7 of the plot, which the
      // six-sample fixture's 0.2 grid cannot reach. That is the bound that
      // matters rather than the exact constant: at the 320px reflow target the
      // plot is 220px and the widest chip ~77px, so a threshold above ~0.66
      // pushes the chip past the merged panel's `overflow-hidden`. Asserting a
      // bound leaves the value free to be retuned upward to 0.66 without a
      // spurious failure, while catching a return to the design kit's 0.72.
      mockGetFitnessRouteData.mockResolvedValue({
        ...routeData,
        altitudeSeries: Array.from({ length: 11 }, (_, index) => 10 + index * 4)
      })

      const panel = await openAnalysis()
      // Sample 7 of 0..10 — `100 + 0.7 * 400`.
      hoverChart(panel, 380)

      expect(screen.getAllByTestId('chart-hover-value')[0]).toHaveStyle({
        left: '70%',
        transform: 'translate(calc(-100% - 12px), -50%)'
      })
    })

    it('places the dot low at a series minimum and high at its maximum', async () => {
      const panel = await openAnalysis()

      // The elevation fixture is [10, 24, 40, 55, 48, 30]: sample 0 is its
      // minimum and sample 3 its maximum. This pins the value -> y projection
      // the line and the dot share, which inverting would swap. The dot is
      // deliberately unclamped — it marks the actual point, so it goes all the
      // way to 100%/0% — while the readout beside it is held inside the plot,
      // which is what 92%/8% is.
      hoverChart(panel, 100)
      expect(screen.getAllByTestId('chart-hover-dot')[0]).toHaveStyle({
        top: '100%'
      })
      expect(screen.getAllByTestId('chart-hover-value')[0]).toHaveStyle({
        top: '92%'
      })

      hoverChart(panel, 340)
      expect(screen.getAllByTestId('chart-hover-dot')[0]).toHaveStyle({
        top: '0%'
      })
      expect(screen.getAllByTestId('chart-hover-value')[0]).toHaveStyle({
        top: '8%'
      })
    })

    // `left` pins the index -> x projection the line, the dot and the readout
    // all share: sample 1 of 6 sits a fifth of the way across, sample 5 at the
    // end. Without it the scale can be changed and only the flip threshold —
    // which both cases clear by a wide margin — would notice.
    it.each([
      {
        description: 'right of the dot away from the edge',
        clientX: 200,
        left: '20%',
        transform: 'translate(12px, -50%)'
      },
      {
        description: 'flipped left of the dot near the end',
        clientX: 480,
        left: '100%',
        transform: 'translate(calc(-100% - 12px), -50%)'
      }
    ])(
      'places the readout $description',
      async ({ clientX, left, transform }) => {
        const panel = await openAnalysis()

        hoverChart(panel, clientX)

        for (const readout of screen.getAllByTestId('chart-hover-value')) {
          expect(readout).toHaveStyle({ left, transform })
        }
        // The dot is placed from the same projection, so no change to the x
        // scale can move one of the two without the other.
        for (const dot of screen.getAllByTestId('chart-hover-dot')) {
          expect(dot).toHaveStyle({ left })
        }
      }
    )

    // A 1 Hz recording arrives as one sample per second, so a plotted point per
    // ~51s of it — which is what the old flat 120-point cap produced — averages
    // every short climb and sprint away. Strava draws one point per 8 samples
    // (measured on two of its own activity Analysis pages: 5,913 -> 740 and
    // 5,272 -> 659), so these are the ratios, not round numbers.
    it.each([
      { description: '5913 samples like the reference ride', raw: 5_913 },
      { description: '5272 samples like the second ride', raw: 5_272 },
      // Just above where the 120-point floor stops binding (it binds below 956
      // samples), so this case pins the RATIO rather than the clamp — the two
      // rows above would still pass if the ratio were replaced by any cap of
      // their own value, and the floor case below passes even against the old
      // flat 120.
      { description: '1000 samples just past the floor', raw: 1_000 }
    ])('plots $description at Strava density', async ({ raw }) => {
      const ramp = Array.from({ length: raw }, (_, index) => index)
      mockGetFitnessRouteData.mockResolvedValue({
        ...routeData,
        altitudeSeries: ramp,
        speedSeries: ramp,
        powerSeries: ramp,
        heartRateSeries: ramp
      })

      const panel = await openAnalysis()

      const expected = Math.round(raw / 8)
      const pointCounts = Array.from(panel.querySelectorAll('path')).map(
        (path) => (path.getAttribute('d') ?? '').match(/[LM]/g)?.length ?? 0
      )
      expect(pointCounts).toEqual([expected, expected, expected, expected])
    })

    // The ratio is clamped at both ends: a short activity never gets coarser
    // than it already was, and a very long one never grows an unbounded path.
    it.each([
      {
        description: 'floors a short recording at 120 points',
        raw: 600,
        expected: 120
      },
      {
        description: 'caps a very long recording at 1200 points',
        raw: 40_000,
        expected: 1_200
      }
    ])('$description', async ({ raw, expected }) => {
      const ramp = Array.from({ length: raw }, (_, index) => index)
      mockGetFitnessRouteData.mockResolvedValue({
        ...routeData,
        altitudeSeries: ramp
      })

      const panel = await openAnalysis()

      const [elevationPath] = Array.from(panel.querySelectorAll('path'))
      expect(
        (elevationPath.getAttribute('d') ?? '').match(/[LM]/g)
      ).toHaveLength(expected)
    })

    // Downsampling is a bin average, so a series shorter than the floor has to
    // survive untouched — otherwise a two-minute activity would be resampled
    // for no reason and its samples would stop lining up with the map.
    it('leaves a series shorter than the floor at its own resolution', async () => {
      const panel = await openAnalysis()

      const [elevationPath] = Array.from(panel.querySelectorAll('path'))
      expect(
        (elevationPath.getAttribute('d') ?? '').match(/[LM]/g)
      ).toHaveLength(routeData.altitudeSeries?.length ?? 0)
    })
  })

  describe('overview elevation profile', () => {
    // Same contract as the analysis stack, on the summary card: drag it and it
    // reports the elevation under the pointer and moves the highlight on the
    // map above it. It used to be a static picture.
    const hoverElevation = (clientX: number) => {
      const profile = screen.getByTestId('overview-elevation-profile')
      const [plot] = Array.from(profile.querySelectorAll('svg'))
      plot.getBoundingClientRect = () => ({ left: 100, width: 400 }) as DOMRect
      fireEvent.mouseMove(plot, { clientX })
      return plot
    }

    const renderOverview = async () => {
      renderDetail()
      await waitFor(() =>
        expect(
          screen.getByTestId('overview-elevation-profile')
        ).toBeInTheDocument()
      )
    }

    it('reports the elevation under the pointer while it is dragged', async () => {
      await renderOverview()

      expect(screen.queryAllByTestId('chart-hover-value')).toHaveLength(0)

      // A quarter of the way across => 450s of a 1800s ride => sample index 1
      // of the [10, 24, 40, 55, 48, 30] fixture.
      const plot = hoverElevation(200)

      const [readout] = screen.getAllByTestId('chart-hover-value')
      expect(readout).toHaveTextContent(/^24m$/)
      // The card header carries the instant, so the value has a time to belong
      // to without a second readout chip. It REPLACES the gain rather than
      // prefixing it: at 320px a prefixed "1:18:29 · 455 m gain" outgrows the
      // heading row and wraps it to two lines, which moves the chart under the
      // finger that is dragging it.
      expect(screen.getByText('7:30')).toBeInTheDocument()
      expect(screen.queryByText(/120 m gain/)).not.toBeInTheDocument()

      fireEvent.mouseLeave(plot)
      expect(screen.queryAllByTestId('chart-hover-value')).toHaveLength(0)
      expect(screen.getByText('120 m gain')).toBeInTheDocument()
    })

    // Four ticks, not the helper's default six. `justify-between` gives the
    // label row no way to wrap, and six H:MM:SS labels are wider than this
    // card's 212px content box at the 320px reflow target — so they ran
    // together into one unbroken string of digits and, past ~5h, crossed the
    // card's own border, which a Card has no `overflow-hidden` to clip. The
    // 10:00/20:00 pair is what distinguishes this from the six-tick set.
    it('labels its time axis with four ticks, which fit the card at 320px', async () => {
      await renderOverview()

      const profile = screen.getByTestId('overview-elevation-profile')
      const labels = Array.from(profile.lastElementChild?.children ?? []).map(
        (label) => label.textContent
      )

      expect(labels).toEqual(['0:00', '10:00', '20:00', '30:00'])
    })

    it('scrubs on touch as well as on hover', async () => {
      await renderOverview()

      const profile = screen.getByTestId('overview-elevation-profile')
      const [plot] = Array.from(profile.querySelectorAll('svg'))
      plot.getBoundingClientRect = () => ({ left: 100, width: 400 }) as DOMRect

      fireEvent.touchStart(plot, { touches: [{ clientX: 200 }] })
      expect(screen.getAllByTestId('chart-hover-value')[0]).toHaveTextContent(
        /^24m$/
      )

      fireEvent.touchEnd(plot)
      expect(screen.queryAllByTestId('chart-hover-value')).toHaveLength(0)
    })

    // The whole point of the scrub is the map, and the map only follows a
    // highlight the Overview's own panel is given — the prop used to be passed
    // on the Analysis section's panel alone, so the profile could report a
    // value with nothing moving beside it.
    it('follows the scrubbed instant on the map above it', async () => {
      renderDetail({ mapProvider: { type: 'apple' } })
      await waitFor(() =>
        expect(screen.getByTestId('route-map')).toBeInTheDocument()
      )

      expect(screen.getByTestId('route-map')).toHaveAttribute(
        'data-highlighted-elapsed-seconds',
        ''
      )

      hoverElevation(200)

      // A quarter of the way across a 1800s ride.
      expect(screen.getByTestId('route-map')).toHaveAttribute(
        'data-highlighted-elapsed-seconds',
        '450'
      )
    })

    it('drops the highlight when the section changes', async () => {
      await renderOverview()

      hoverElevation(200)
      expect(screen.getAllByTestId('chart-hover-value')).not.toHaveLength(0)

      const menu = await openSectionMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Analysis' }))

      expect(screen.queryAllByTestId('chart-hover-value')).toHaveLength(0)
    })
  })

  it('shows the multi-file activity switcher when several files are aggregated', async () => {
    mockGetFitnessFilesByStatus.mockResolvedValue([
      buildFitnessFile({ id: 'fit-1', fileName: 'ride-morning.fit' }),
      buildFitnessFile({
        id: 'fit-2',
        fileName: 'ride-evening.fit',
        isPrimary: false,
        activityStartTime: Date.parse('2026-05-27T18:00:00Z')
      })
    ])

    renderDetail()

    const select = (await screen.findByLabelText(
      'Activity file'
    )) as HTMLSelectElement
    expect(within(select).getAllByRole('option')).toHaveLength(2)
    expect(screen.getByText('file 1 of 2')).toBeInTheDocument()

    fireEvent.change(select, { target: { value: 'fit-2' } })
    await waitFor(() =>
      expect(screen.getByText('file 2 of 2')).toBeInTheDocument()
    )
  })

  it('renders the route map without a GPS trace badge', async () => {
    renderDetail()

    // Positive anchor first: the zoom control lives in the same overlay
    // fragment the badge used to, so its presence proves the overlay really
    // rendered and the badge assertion below is not vacuous.
    expect(await screen.findByLabelText('Zoom in map')).toBeInTheDocument()
    expect(screen.queryByText('GPS trace')).not.toBeInTheDocument()
  })

  it('omits the privacy notice when no segment is hidden', async () => {
    renderDetail()

    expect(await screen.findByLabelText('Zoom in map')).toBeInTheDocument()
    expect(
      screen.queryByText('Green segments are hidden from other viewers')
    ).not.toBeInTheDocument()
  })

  it('dismisses the hidden-privacy-segment notice when it is tapped', async () => {
    mockGetFitnessRouteData.mockResolvedValue(routeDataWithHiddenSegments)

    renderDetail()

    const notice = await screen.findByRole('button', {
      name: 'Dismiss notice: green segments are hidden from other viewers'
    })
    fireEvent.click(notice)

    await waitFor(() =>
      expect(
        screen.queryByText('Green segments are hidden from other viewers')
      ).not.toBeInTheDocument()
    )
  })

  it('brings the privacy notice back when another activity file is selected', async () => {
    mockGetFitnessFilesByStatus.mockResolvedValue([
      buildFitnessFile({ id: 'fit-1', fileName: 'ride-morning.gpx' }),
      buildFitnessFile({
        id: 'fit-2',
        fileName: 'ride-evening.gpx',
        isPrimary: false,
        activityStartTime: Date.parse('2026-05-27T18:00:00Z')
      })
    ])
    mockGetFitnessRouteData.mockResolvedValue(routeDataWithHiddenSegments)

    renderDetail()

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Dismiss notice: green segments are hidden from other viewers'
      })
    )
    await waitFor(() =>
      expect(
        screen.queryByText('Green segments are hidden from other viewers')
      ).not.toBeInTheDocument()
    )

    // The panel is not keyed per file, so a dismissal must not carry over to a
    // different route that also has hidden segments.
    fireEvent.change(await screen.findByLabelText('Activity file'), {
      target: { value: 'fit-2' }
    })

    expect(
      await screen.findByText('Green segments are hidden from other viewers')
    ).toBeInTheDocument()
  })

  it('keeps the privacy notice dismissed when its own file is selected again', async () => {
    // The dismissal is scoped to the acknowledged file, so reloading that file's
    // route must not resurrect the notice. Deriving it during render is what
    // guarantees that: the reset used to live in an effect keyed on the
    // `routeSegments` identity, and a passive effect runs a task *after* the
    // commit that revealed the notice — late enough to land after the user's tap
    // and undo it. That race is what made this suite flake on CI.
    mockGetFitnessFilesByStatus.mockResolvedValue([
      buildFitnessFile({ id: 'fit-1', fileName: 'ride-morning.gpx' }),
      buildFitnessFile({
        id: 'fit-2',
        fileName: 'ride-evening.gpx',
        isPrimary: false,
        activityStartTime: Date.parse('2026-05-27T18:00:00Z')
      })
    ])
    mockGetFitnessRouteData.mockResolvedValue(routeDataWithHiddenSegments)

    renderDetail()

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Dismiss notice: green segments are hidden from other viewers'
      })
    )
    const select = await screen.findByLabelText('Activity file')

    fireEvent.change(select, { target: { value: 'fit-2' } })
    expect(
      await screen.findByText('Green segments are hidden from other viewers')
    ).toBeInTheDocument()

    fireEvent.change(select, { target: { value: 'fit-1' } })
    // Wait for fit-1's route to be re-fetched and committed — that commit is
    // exactly where the old reset fired.
    await waitFor(() =>
      expect(mockGetFitnessRouteData).toHaveBeenCalledTimes(3)
    )
    await act(async () => {})

    expect(await screen.findByText('file 1 of 2')).toBeInTheDocument()
    expect(
      screen.queryByText('Green segments are hidden from other viewers')
    ).not.toBeInTheDocument()
  })

  it('surfaces an error banner when route data fails to load', async () => {
    mockGetFitnessRouteData.mockRejectedValue(new Error('boom'))

    renderDetail()

    expect(
      await screen.findByText(
        'Could not load route and analysis data for this activity.'
      )
    ).toBeInTheDocument()
  })

  describe('route map failure', () => {
    // This page replaces `Post` for a completed fitness activity, so the retry
    // `Post` offers has to exist here too — otherwise the owner who opens the
    // activity to ask where their map went cannot act on it.
    const mapFailedStatus = () =>
      buildStatus({
        fitness: {
          ...buildStatus().fitness,
          mapFailure: 'missing' as const
        }
      } as Partial<StatusNote>)

    it('offers the owner a retry for a missing route map', () => {
      renderDetail({ status: mapFailedStatus() })

      expect(
        screen.getByText(/route map image could not be generated/i)
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument()
    })

    it('says nothing to a viewer who is not the owner', () => {
      renderDetail({ status: mapFailedStatus(), currentActor: null })

      expect(
        screen.queryByText(/route map image could not be/i)
      ).not.toBeInTheDocument()
    })

    it('does not offer a retry when the map is fine', () => {
      renderDetail()

      expect(
        screen.queryByText(/route map image could not be/i)
      ).not.toBeInTheDocument()
    })
  })

  it('excludes 0 bpm sensor dropouts from the heart-rate average and max', async () => {
    // Without filtering, avg over [0,150,0,150,150] would be 60; the positive
    // samples [150,150,150] give avg 150 / max 150, matching the zone buckets.
    mockGetFitnessRouteData.mockResolvedValue({
      ...routeData,
      heartRateSeries: [0, 150, 0, 150, 150]
    })

    renderDetail()

    await waitFor(() => expect(screen.getByText('Avg HR')).toBeInTheDocument())

    const menu = await openSectionMenu()
    fireEvent.click(
      within(menu).getByRole('menuitem', { name: 'Heart rate zones' })
    )

    expect(
      await screen.findByText(
        (_, element) => element?.textContent === 'avg 150 · max 150 bpm'
      )
    ).toBeInTheDocument()
  })
  describe('action row', () => {
    it('renders the shared post action row rather than a page-specific one', () => {
      renderDetail()

      // The shared `Actions` row: same controls, same order, same spacing as
      // every other surface. A hand-rolled row here is how this page drifted
      // into a right-packed cluster with its own gaps.
      const actions = screen.getByRole('group', { name: 'Post actions' })
      expect(
        within(actions)
          .getAllByRole('button')
          .map((button) => button.textContent)
      ).toEqual(['Reply', 'Boost', 'Like', 'Bookmark', '', 'More'])
      // Neither class is observable in jsdom and both are load-bearing: the
      // card footer's own padding already puts the row at the status's left
      // edge, so the avatar-column pull would drag it outside the card, and
      // `justify-between` is what makes the spacing between actions identical
      // to every other surface.
      // `mt-3` rides along with the pull, so pin its absence too — hoisting it
      // out of the `fullBleed` branch would silently add 12px above this
      // footer row while `post.test.tsx` stayed green. One assertion each:
      // `.not.toHaveClass(a, b)` passes when EITHER is missing, so the two
      // together would still pass with `mt-3` wrongly present.
      expect(actions).not.toHaveClass('-ml-13')
      expect(actions).not.toHaveClass('mt-3')
      expect(actions).toHaveClass('justify-between')
    })

    it('renders no action row for a logged-out reader', () => {
      renderDetail({ currentActor: null })

      expect(
        screen.queryByRole('group', { name: 'Post actions' })
      ).not.toBeInTheDocument()
    })
  })

  describe('reactions', () => {
    // This page lays out its own card instead of going through `Posts`, so it
    // has to place the chip row itself and hand the same state to the shared
    // `Actions` row — a fitness post is the one surface where losing either
    // half means an existing reaction is invisible or a new one cannot be
    // added.
    it('renders the reaction chips above the action row', () => {
      renderDetail({ status: buildReactedStatus() })

      expect(
        screen.getByLabelText('Add \u{1F525} reaction, 3')
      ).toHaveTextContent('3')
    })

    it('places the chips in the card body under the stats, not in the action strip', () => {
      renderDetail({ status: buildReactedStatus() })

      // Anchored on the stat grid's own container rather than the chips'
      // parent, so wrapping the chips in one more div doesn't fail this.
      const cardBody = screen.getByText('Distance').closest('div.grid')
        ?.parentElement as HTMLElement
      expect(cardBody).toContainElement(screen.getByTestId('reaction-chips'))
      expect(cardBody).not.toContainElement(
        screen.getByRole('group', { name: 'Post actions' })
      )
    })

    it('offers the picker trigger in its action row', () => {
      renderDetail({ status: buildReactedStatus() })

      expect(
        screen.getByRole('button', { name: 'Add reaction, 3 reactions' })
      ).toBeInTheDocument()
    })

    it('leaves a logged-out reader the chips without a way to react', () => {
      renderDetail({ currentActor: null, status: buildReactedStatus() })

      expect(
        screen.getByRole('img', { name: '\u{1F525} reaction, 3' })
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /^Add reaction/ })
      ).not.toBeInTheDocument()
    })

    it('renders no chip row on a post nobody has reacted to', () => {
      renderDetail()

      // The wrapper, not the chips: `ReactionRow` already renders nothing at
      // zero reactions, so an ungated wrapper leaves a bare `border-t` rule
      // with its padding under it — which no chip query can see.
      expect(screen.queryByTestId('reaction-chips')).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Add reaction' })
      ).toBeInTheDocument()
    })
  })

  describe('source file link', () => {
    // The raw upload carries the whole track, including the ends a privacy
    // location trims off the map and the route data, so
    // `GET /api/v1/fitness-files/:id` is owner-only and the link has to match.
    it('offers the owner a link to the source file', async () => {
      renderDetail()

      const link = await screen.findByRole('link', { name: /ride\.fit/ })
      expect(link).toHaveAttribute('href', '/api/v1/fitness-files/fit-1')
    })

    it.each([
      {
        description: 'withholds the download from a signed-in viewer',
        currentActor: notMe
      },
      {
        description: 'withholds the download from a logged-out reader',
        currentActor: null
      }
    ])(
      '$description',
      async ({ currentActor }: { currentActor: ActorProfile | null }) => {
        renderDetail({ currentActor })

        // The name still shows — it is the label saying which file this panel
        // describes, and with several attached it is what the selector switches
        // between. Only the anchor goes, because the endpoint 404s for them.
        await waitFor(() =>
          expect(screen.getByText('ride.fit')).toBeInTheDocument()
        )
        expect(
          screen.queryByRole('link', { name: /ride\.fit/ })
        ).not.toBeInTheDocument()
      }
    )

    it('keeps the action row for a logged-out reader', async () => {
      // The footer that holds the link also holds the shared `<Actions>`, and
      // its gate used to be `sourceHref || currentActor` — which was always true
      // because a fitness post always had a source href. Keying that gate on
      // ownership would have taken the actions away from every logged-out
      // reader along with the link.
      renderDetail({ currentActor: null, status: buildReactedStatus() })

      expect(
        await screen.findByRole('img', { name: '\u{1F525} reaction, 3' })
      ).toBeInTheDocument()
    })
  })
})
