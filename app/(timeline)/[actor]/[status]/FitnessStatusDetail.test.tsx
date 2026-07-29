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

  it('filters the analysis graphs and syncs the available series', async () => {
    renderDetail()

    await waitFor(() => expect(screen.getByText('Avg HR')).toBeInTheDocument())

    const menu = await openSectionMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Analysis' }))

    // Graph-display pills appear for every available series.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Elevation' })
      ).toBeInTheDocument()
    )
    expect(screen.getByRole('button', { name: 'Speed' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Power' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Heart rate' })
    ).toBeInTheDocument()
    // All charts render in the default "All graphs" mode.
    expect(
      screen.getByRole('heading', { name: 'Elevation profile' })
    ).toBeInTheDocument()

    // Selecting a single graph filters the rest out.
    fireEvent.click(screen.getByRole('button', { name: 'Power' }))
    expect(screen.getByRole('button', { name: 'Power' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(
      screen.queryByRole('heading', { name: 'Elevation profile' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Power' })).toBeInTheDocument()
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

    it('stacks every visible graph into one panel instead of separate cards', async () => {
      const panel = await openAnalysis()

      // One shared panel, four rows — not four independently bordered cards
      // with gaps between them.
      expect(screen.getAllByTestId('analysis-graphs')).toHaveLength(1)
      expect(
        within(panel)
          .getAllByRole('heading', { level: 3 })
          .map((heading) => heading.textContent)
      ).toEqual(['Elevation profile', 'Speed', 'Power', 'Heart rate'])
    })

    it('keeps the single panel when the display is filtered to one graph', async () => {
      const panel = await openAnalysis()

      fireEvent.click(screen.getByRole('button', { name: 'Speed' }))

      expect(within(panel).getAllByRole('heading', { level: 3 })).toHaveLength(
        1
      )
      expect(
        within(panel).getByRole('heading', { name: 'Speed' })
      ).toBeInTheDocument()
    })

    it('shows a value readout on every graph while one is hovered', async () => {
      const panel = await openAnalysis()

      expect(screen.queryAllByTestId('chart-hover-value')).toHaveLength(0)

      // jsdom reports a zero-width box, so the pointer ratio collapses to
      // clientX clamped into 0..1 — clientX 1 is the end of the activity.
      const [elevationChart] = Array.from(panel.querySelectorAll('svg'))
      fireEvent.mouseMove(elevationChart, { clientX: 1 })

      // Hovering one graph highlights the same instant on all of them, so each
      // reports its own value at that time.
      const readouts = screen.getAllByTestId('chart-hover-value')
      expect(readouts).toHaveLength(4)
      expect(readouts.map((readout) => readout.textContent)).toEqual([
        '30m',
        '16.0km/h',
        '60w',
        '140bpm'
      ])
      expect(screen.getByText('Selected time: 30:00')).toBeInTheDocument()

      fireEvent.mouseLeave(elevationChart)
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
    })

    it('renders no action row for a logged-out reader', () => {
      renderDetail({ currentActor: null })

      expect(
        screen.queryByRole('group', { name: 'Post actions' })
      ).not.toBeInTheDocument()
    })
  })

  describe('reactions', () => {
    // This page composes its own action row instead of going through `Posts`,
    // so both halves of the reaction control have to be wired by hand here —
    // and a fitness post is the one surface where losing either of them means
    // an existing reaction is invisible or a new one cannot be added.
    it('renders the reaction chips above the action row', () => {
      renderDetail({
        status: buildStatus({
          reactions: [
            {
              name: '\u{1F525}',
              count: 3,
              me: false,
              url: null,
              static_url: null
            }
          ]
        } as Partial<StatusNote>)
      })

      expect(
        screen.getByLabelText('Add \u{1F525} reaction, 3')
      ).toHaveTextContent('3')
    })

    it('places the chips in the card body under the stats, not in the action strip', () => {
      renderDetail({
        status: buildStatus({
          reactions: [
            {
              name: '\u{1F525}',
              count: 3,
              me: false,
              url: null,
              static_url: null
            }
          ]
        } as Partial<StatusNote>)
      })

      const body = screen.getByTestId('reaction-chips')
        .parentElement as HTMLElement
      expect(within(body).getByText('Distance')).toBeInTheDocument()
      expect(
        within(body).queryByRole('group', { name: 'Post actions' })
      ).not.toBeInTheDocument()
    })

    it('offers the picker trigger in its action row', () => {
      renderDetail({
        status: buildStatus({
          reactions: [
            {
              name: '\u{1F525}',
              count: 3,
              me: false,
              url: null,
              static_url: null
            }
          ]
        } as Partial<StatusNote>)
      })

      expect(
        screen.getByRole('button', { name: 'Add reaction, 3 reactions' })
      ).toBeInTheDocument()
    })

    it('leaves a logged-out reader the chips without a way to react', () => {
      renderDetail({
        currentActor: null,
        status: buildStatus({
          reactions: [
            {
              name: '\u{1F525}',
              count: 3,
              me: false,
              url: null,
              static_url: null
            }
          ]
        } as Partial<StatusNote>)
      })

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
})
