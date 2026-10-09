/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'

import type { Status, StatusNote } from '@/lib/types/domain/status'
import { loadMaplibreModule } from '@/lib/utils/maplibre'

import { mockPush } from './FitnessStatusDetail.mocks'
import {
  actor,
  buildFitnessFile,
  buildStatus,
  mockGetFitnessFilesByStatus,
  mockGetFitnessRouteData,
  openSectionMenu,
  renderDetail,
  resetFitnessStatusDetailMocks
} from './FitnessStatusDetail.testUtils'

vi.mock('@/lib/client', () => ({
  getFitnessFilesByStatus: vi.fn(),
  getFitnessGearList: vi.fn(),
  getFitnessRouteData: vi.fn(),
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

  it('renders summary metrics and elevation chart on overview without fetching route data, and defers route data to analysis', async () => {
    mockGetFitnessRouteData.mockClear()
    const statusWithMetrics = buildStatus({
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
        hasMapData: false,
        avgPower: 215,
        maxPower: 580,
        avgHeartRate: 148,
        maxHeartRate: 172,
        totalWorkKj: 387,
        elevationSeries: [10, 25, 45, 60, 50, 30]
      }
    })

    renderDetail({ status: statusWithMetrics })

    // Summary metrics appear immediately without waiting for route data
    expect(screen.getByText('Avg HR')).toBeInTheDocument()
    expect(screen.getByText('148')).toBeInTheDocument()
    expect(screen.getByText('max 172 bpm')).toBeInTheDocument()
    expect(screen.getByText('Total work')).toBeInTheDocument()
    expect(screen.getByText('387')).toBeInTheDocument()
    expect(screen.getByText('kJ')).toBeInTheDocument()
    expect(screen.getByText('Avg power')).toBeInTheDocument()
    expect(screen.getByText('215')).toBeInTheDocument()
    expect(screen.getAllByText('watts')).toHaveLength(2)
    expect(screen.getByText('Max power')).toBeInTheDocument()
    expect(screen.getByText('580')).toBeInTheDocument()
    expect(screen.getByTestId('overview-elevation-profile')).toBeInTheDocument()

    // Route data was NOT fetched on overview
    expect(mockGetFitnessRouteData).not.toHaveBeenCalled()

    // Switching to analysis fetches route data
    const menu = await openSectionMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Analysis' }))

    await waitFor(() => {
      expect(mockGetFitnessRouteData).toHaveBeenCalledWith('fit-1')
    })
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
      fireEvent.keyDown(screen.getByRole('button', { name: /Overview/ }), {
        key: 'ArrowDown'
      })
      fireEvent.click(
        within(screen.getByRole('menu')).getByRole('menuitem', {
          name: 'Analysis'
        })
      )
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

  it('activates the interactive map on Overview when the Play button is clicked', async () => {
    const statusWithMap = buildStatus({
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
        hasMapData: true,
        avgPower: 210,
        maxPower: 450,
        avgHeartRate: 145,
        maxHeartRate: 172,
        totalWorkKj: 387,
        elevationSeries: [10, 25, 45, 60, 50, 30]
      } as never
    })
    const map = {
      addControl: vi.fn(),
      addLayer: vi.fn(),
      addSource: vi.fn(),
      fitBounds: vi.fn(),
      getCanvas: vi.fn(() => document.createElement('canvas')),
      getSource: vi.fn(() => null),
      on: vi.fn(),
      once: vi.fn((event, handler) => {
        if (event === 'load') handler()
      }),
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

    renderDetail({ status: statusWithMap })

    // Overview starts in static mode with the Play button visible
    const playButton = screen.getByRole('button', {
      name: 'Load interactive route map'
    })
    expect(playButton).toBeInTheDocument()
    expect(MapConstructor).not.toHaveBeenCalled()

    // Click the Play button
    fireEvent.click(playButton)

    // The map is constructed on Overview without needing to switch to Analysis
    await waitFor(() => {
      expect(MapConstructor).toHaveBeenCalledTimes(1)
    })
  })

  it('renders the activity header with the type badge and primary stats', async () => {
    renderDetail()

    expect(screen.getByText('Athlete Runner')).toBeInTheDocument()
    expect(screen.getByText('@athlete@activities.local')).toBeInTheDocument()
    // Type badge derived from the activity type.
    expect(screen.getByText('Ride')).toBeInTheDocument()
    // The caption renders as normal post content, not a page heading.
    expect(screen.getByText('Sunset loop')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    // Primary stat strip.
    expect(screen.getByText('Distance')).toBeInTheDocument()
    expect(screen.getByText('5.00')).toBeInTheDocument()
    expect(screen.getByText('Moving time')).toBeInTheDocument()
    expect(screen.getByText('30:00')).toBeInTheDocument()

    // The secondary Overview stats derive from the loaded route series.
    await waitFor(() => expect(screen.getByText('Avg HR')).toBeInTheDocument())
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
      expect(screen.queryByText('Ride')).toBeInTheDocument()
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
    // Signed in, the page is a full-bleed card below `md` and the comment list
    // spans it.
    expect(screen.getByTestId('reply-post').closest('.divide-y')).toHaveClass(
      'max-md:mx-[calc(50%_-_50vw)]',
      'max-md:w-auto'
    )
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
    // The logged-out page is an inset card below `md`; a viewport-wide list
    // would run out past that card's edges, so it keeps the card's own width.
    const list = screen.getByTestId('reply-post').closest('.divide-y')
    expect(list).not.toHaveClass('max-md:mx-[calc(50%_-_50vw)]')
    expect(list).not.toHaveClass('max-md:w-auto')
  })

  it('navigates to reply status detail when reply openStatus is triggered', async () => {
    const reply = {
      id: 'reply-1',
      type: 'Note',
      actorId: actor.id,
      actor
    } as unknown as Status

    renderDetail({ replies: [reply] })

    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))

    expect(screen.getByTestId('reply-post')).toHaveTextContent('reply-1')
    expect(screen.getByTestId('open-reply-reply-1')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('open-reply-reply-1'))

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/@actor/reply-1')
    })
  })

  describe('multi-file activity switcher', () => {
    const renderAggregatedFiles = () => {
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
    }

    it('offers an Activity file select with one option per file, in a card beside the activity card', async () => {
      renderAggregatedFiles()

      const select = (await screen.findByLabelText(
        'Activity file'
      )) as HTMLSelectElement
      // The switcher is its own card, beside the activity card.
      const switcherCard = select.closest('div.rounded-xl') as HTMLElement
      expect(switcherCard).toContainElement(screen.getByText('Activity file'))
      // A card of its own, beside the activity card rather than inside it: the
      // activity card is the one holding the file position in its footer, and the
      // two share the page's column.
      const activityCard = switcherCard.previousElementSibling as HTMLElement
      expect(activityCard).toContainElement(screen.getByText('file 1 of 2'))
      expect(activityCard).not.toContainElement(select)
      expect(activityCard).not.toContainElement(switcherCard)
      expect(switcherCard.parentElement).toBe(activityCard.parentElement)
      expect(within(select).getAllByRole('option')).toHaveLength(2)
      expect(screen.getByText('file 1 of 2')).toBeInTheDocument()
    })

    it('switches the shown file when another option is picked', async () => {
      renderAggregatedFiles()

      const select = (await screen.findByLabelText(
        'Activity file'
      )) as HTMLSelectElement

      fireEvent.change(select, { target: { value: 'fit-2' } })
      await waitFor(() =>
        expect(screen.getByText('file 2 of 2')).toBeInTheDocument()
      )
    })
  })

  it('shows no activity-file switcher card for a status with a single fitness file', async () => {
    mockGetFitnessFilesByStatus.mockResolvedValue([
      buildFitnessFile({ id: 'fit-1', fileName: 'ride-morning.fit' })
    ])

    renderDetail()

    // Positive anchor first: the file row is what the loaded file renders, so
    // the absences below are not just "the files have not arrived yet".
    expect(await screen.findByText('ride-morning.fit')).toBeInTheDocument()
    expect(screen.queryByLabelText('Activity file')).not.toBeInTheDocument()
    expect(screen.queryByText('Activity file')).not.toBeInTheDocument()
    expect(screen.queryByText(/^file \d+ of \d+$/)).not.toBeInTheDocument()
  })
})
