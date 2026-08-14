/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  type GearActivityStatusesPage,
  getFitnessGearActivities
} from '@/lib/client'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusType } from '@/lib/types/domain/status'

import { GearActivitiesFeed } from './GearActivitiesFeed'

vi.mock('@/lib/client', () => ({
  getFitnessGearActivities: vi.fn()
}))

// The stub renders one delete and one edit control per post, because the feed's
// `onPostDeleted` / `onPostUpdated` handlers are its own logic and nothing else
// can reach them — the real `Posts` fires them from an action row this file
// deliberately does not render.
vi.mock('@/lib/components/posts/posts', () => ({
  Posts: (props: {
    host: string
    currentTime: number
    statuses: Status[]
    currentActor?: ActorProfile
    showActions?: boolean
    isMediaUploadEnabled?: boolean
    onPostDeleted?: (status: Status) => void
    onPostUpdated?: (status: Status) => void
  }) => (
    <div
      data-testid="posts"
      data-host={props.host}
      data-current-time={props.currentTime}
      data-current-actor={props.currentActor?.id ?? ''}
      data-show-actions={String(Boolean(props.showActions))}
      data-media-upload={String(Boolean(props.isMediaUploadEnabled))}
    >
      {props.statuses.map((status) => (
        <div key={status.id}>
          {status.text}
          <button type="button" onClick={() => props.onPostDeleted?.(status)}>
            {`delete ${status.id}`}
          </button>
          <button
            type="button"
            onClick={() =>
              props.onPostUpdated?.({
                ...status,
                text: `${status.text} (edited)`
              })
            }
          >
            {`edit ${status.id}`}
          </button>
        </div>
      ))}
    </div>
  )
}))

const mockGetFitnessGearActivities =
  getFitnessGearActivities as jest.MockedFunction<
    typeof getFitnessGearActivities
  >

const FIXED_CURRENT_TIME = new Date('2026-06-01T10:00:00.000Z').getTime()

const profile: ActorProfile = {
  id: 'https://llun.test/users/test',
  username: 'test',
  domain: 'llun.test',
  name: 'Test',
  followersUrl: 'https://llun.test/users/test/followers',
  inboxUrl: 'https://llun.test/users/test/inbox',
  sharedInboxUrl: 'https://llun.test/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: FIXED_CURRENT_TIME
}

const createStatus = (id: string, text = id): Status => ({
  id,
  actorId: profile.id,
  actor: profile,
  to: [],
  cc: [],
  edits: [],
  isLocalActor: true,
  createdAt: FIXED_CURRENT_TIME,
  updatedAt: FIXED_CURRENT_TIME,
  type: StatusType.enum.Note,
  url: id,
  text,
  summary: null,
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  totalLikes: 0,
  attachments: [],
  tags: []
})

const page = (
  overrides: Partial<GearActivityStatusesPage> = {}
): GearActivityStatusesPage => ({
  statuses: [],
  hasMore: false,
  nextOffset: 0,
  ...overrides
})

const renderFeed = (
  props: Partial<Parameters<typeof GearActivitiesFeed>[0]> = {}
) =>
  render(
    <GearActivitiesFeed
      gearId="gear-1"
      host="llun.test"
      currentTime={FIXED_CURRENT_TIME}
      currentActor={profile}
      isMediaUploadEnabled
      emptyMessage="No recent activities on this gear."
      {...props}
    />
  )

describe('GearActivitiesFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetFitnessGearActivities.mockResolvedValue(page())
  })

  it('renders the first page through the shared interactive feed', async () => {
    mockGetFitnessGearActivities.mockResolvedValue(
      page({ statuses: [createStatus('status-1', 'Morning ride')] })
    )
    renderFeed()

    const posts = await screen.findByTestId('posts')
    expect(posts).toHaveTextContent('Morning ride')
    // The whole point of the feed: the same post, with the same actions, as
    // every other surface that renders a status.
    expect(posts).toHaveAttribute('data-show-actions', 'true')
    expect(posts).toHaveAttribute('data-current-actor', profile.id)
    expect(posts).toHaveAttribute('data-host', 'llun.test')
    expect(posts).toHaveAttribute('data-media-upload', 'true')
    // Server-supplied, never `Date.now()` in render — that is what breaks
    // hydration on every relative timestamp below it.
    expect(posts).toHaveAttribute(
      'data-current-time',
      String(FIXED_CURRENT_TIME)
    )
    expect(mockGetFitnessGearActivities).toHaveBeenCalledWith('gear-1', {
      limit: 20
    })
  })

  it('reports an empty history with the caller’s own wording', async () => {
    renderFeed({
      emptyMessage: 'No recent activities recorded with this device.'
    })

    expect(
      await screen.findByText('No recent activities recorded with this device.')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('posts')).not.toBeInTheDocument()
  })

  it('surfaces a failure to load the activities', async () => {
    mockGetFitnessGearActivities.mockRejectedValue(
      new Error('Activity service down')
    )
    renderFeed()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Activity service down'
    )
  })

  it('pages from the offset the server handed back, not the post count', async () => {
    // The two differ whenever an activity's post was deleted: the row still
    // counts toward the gear's totals but carries no status, so paging from
    // `statuses.length` would re-request every row in between.
    mockGetFitnessGearActivities.mockResolvedValueOnce(
      page({
        statuses: [createStatus('status-1', 'Morning ride')],
        hasMore: true,
        nextOffset: 20
      })
    )
    renderFeed()

    const loadMore = await screen.findByRole('button', { name: 'Load more' })
    mockGetFitnessGearActivities.mockResolvedValueOnce(
      page({ statuses: [createStatus('status-2', 'Evening ride')] })
    )
    fireEvent.click(loadMore)

    await waitFor(() =>
      expect(screen.getByText('Evening ride')).toBeInTheDocument()
    )
    expect(mockGetFitnessGearActivities).toHaveBeenLastCalledWith('gear-1', {
      limit: 20,
      offset: 20
    })
    expect(screen.getByText('Morning ride')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Load more' })
    ).not.toBeInTheDocument()
  })

  it('drops a post the next page repeats', async () => {
    // Offset pagination over a growing list repeats the boundary row when an
    // activity is imported between two pages, and React flags the duplicate
    // key.
    mockGetFitnessGearActivities.mockResolvedValueOnce(
      page({
        statuses: [createStatus('status-1', 'Morning ride')],
        hasMore: true,
        nextOffset: 1
      })
    )
    renderFeed()

    const loadMore = await screen.findByRole('button', { name: 'Load more' })
    mockGetFitnessGearActivities.mockResolvedValueOnce(
      page({
        statuses: [
          createStatus('status-1', 'Morning ride'),
          createStatus('status-2', 'Evening ride')
        ],
        nextOffset: 3
      })
    )
    fireEvent.click(loadMore)

    await waitFor(() =>
      expect(screen.getByText('Evening ride')).toBeInTheDocument()
    )
    expect(screen.getAllByText('Morning ride')).toHaveLength(1)
  })

  it('walks past a page whose activities have all lost their posts', async () => {
    // A page of activity rows can yield no statuses at all — deleting a status
    // only nulls `fitness_files.statusId`, leaving a row that still counts.
    // Handing back a "Load more" that added nothing is what this avoids.
    mockGetFitnessGearActivities.mockResolvedValueOnce(
      page({
        statuses: [createStatus('status-1', 'Morning ride')],
        hasMore: true,
        nextOffset: 20
      })
    )
    renderFeed()

    const loadMore = await screen.findByRole('button', { name: 'Load more' })
    mockGetFitnessGearActivities
      .mockResolvedValueOnce(page({ hasMore: true, nextOffset: 40 }))
      .mockResolvedValueOnce(
        page({
          statuses: [createStatus('status-2', 'Evening ride')],
          nextOffset: 60
        })
      )
    fireEvent.click(loadMore)

    await waitFor(() =>
      expect(screen.getByText('Evening ride')).toBeInTheDocument()
    )
    expect(mockGetFitnessGearActivities).toHaveBeenCalledTimes(3)
    expect(mockGetFitnessGearActivities).toHaveBeenLastCalledWith('gear-1', {
      limit: 20,
      offset: 40
    })
  })

  it('walks the same empty pages on the FIRST load, not only on load more', async () => {
    // Otherwise the first render claims the gear has no activities while an
    // enabled "Load more" underneath it says otherwise — and on a phone the
    // sentinel that would have resolved the contradiction is below the fold.
    mockGetFitnessGearActivities
      .mockResolvedValueOnce(page({ hasMore: true, nextOffset: 20 }))
      .mockResolvedValueOnce(
        page({
          statuses: [createStatus('status-1', 'Morning ride')],
          nextOffset: 40
        })
      )
    renderFeed()

    expect(await screen.findByText('Morning ride')).toBeInTheDocument()
    expect(
      screen.queryByText('No recent activities on this gear.')
    ).not.toBeInTheDocument()
    expect(mockGetFitnessGearActivities).toHaveBeenCalledTimes(2)
    expect(mockGetFitnessGearActivities).toHaveBeenLastCalledWith('gear-1', {
      limit: 20,
      offset: 20
    })
  })

  it('caps one load at five requests and hands back a Load more', async () => {
    // The cap is what keeps one click from walking a five-figure history of
    // postless rows with the button stuck on "Loading...".
    for (let request = 0; request < 10; request += 1) {
      mockGetFitnessGearActivities.mockResolvedValueOnce(
        page({ hasMore: true, nextOffset: (request + 1) * 20 })
      )
    }
    renderFeed()

    const loadMore = await screen.findByRole('button', { name: 'Load more' })
    expect(mockGetFitnessGearActivities).toHaveBeenCalledTimes(5)
    // Nothing came back, but the walk stopped rather than running on, and the
    // reader keeps a button that resumes exactly where it stopped.
    expect(loadMore).toBeEnabled()
    expect(
      screen.queryByText('No recent activities on this gear.')
    ).not.toBeInTheDocument()

    fireEvent.click(loadMore)

    await waitFor(() =>
      expect(mockGetFitnessGearActivities).toHaveBeenCalledTimes(10)
    )
    expect(mockGetFitnessGearActivities).toHaveBeenNthCalledWith(6, 'gear-1', {
      limit: 20,
      offset: 100
    })
  })

  it('never reports an empty history while the server says there is more', async () => {
    // `onPostDeleted` empties a page-one list at any time, so the gate cannot
    // rely on the walk alone.
    mockGetFitnessGearActivities.mockResolvedValue(
      page({ hasMore: true, nextOffset: 20 })
    )
    renderFeed()

    expect(
      await screen.findByRole('button', { name: 'Load more' })
    ).toBeInTheDocument()
    expect(
      screen.queryByText('No recent activities on this gear.')
    ).not.toBeInTheDocument()
  })

  it('stops walking empty pages once the server says there are no more', async () => {
    mockGetFitnessGearActivities.mockResolvedValueOnce(
      page({
        statuses: [createStatus('status-1', 'Morning ride')],
        hasMore: true,
        nextOffset: 20
      })
    )
    renderFeed()

    const loadMore = await screen.findByRole('button', { name: 'Load more' })
    mockGetFitnessGearActivities.mockResolvedValueOnce(
      page({ hasMore: false, nextOffset: 40 })
    )
    fireEvent.click(loadMore)

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Load more' })
      ).not.toBeInTheDocument()
    )
    expect(mockGetFitnessGearActivities).toHaveBeenCalledTimes(2)
  })

  describe('keeping the list in step with the actions on a post', () => {
    const renderWithOnePost = async () => {
      mockGetFitnessGearActivities.mockResolvedValue(
        page({ statuses: [createStatus('status-1', 'Morning ride')] })
      )
      renderFeed()
      await screen.findByText('Morning ride')
    }

    it('drops a post deleted from the feed', async () => {
      await renderWithOnePost()

      fireEvent.click(screen.getByRole('button', { name: 'delete status-1' }))

      expect(screen.queryByText('Morning ride')).not.toBeInTheDocument()
      // The list is empty for a settled reason now, so the gear really has
      // nothing left to show.
      expect(
        screen.getByText('No recent activities on this gear.')
      ).toBeInTheDocument()
    })

    it('replaces an edited post in place rather than dropping it', async () => {
      await renderWithOnePost()

      fireEvent.click(screen.getByRole('button', { name: 'edit status-1' }))

      expect(screen.getByText('Morning ride (edited)')).toBeInTheDocument()
      expect(screen.getByTestId('posts')).toBeInTheDocument()
    })
  })

  describe('a load that fails', () => {
    it('does not claim the gear has no activities', async () => {
      // The effect resets `statuses` and `hasMore` on its way to failing, so
      // the empty-state gate has to exclude the error case explicitly.
      mockGetFitnessGearActivities.mockRejectedValue(
        new Error('Activity service down')
      )
      renderFeed()

      expect(await screen.findByRole('alert')).toBeInTheDocument()
      expect(
        screen.queryByText('No recent activities on this gear.')
      ).not.toBeInTheDocument()
    })

    it('offers a retry, since a failed first load leaves nothing to page from', async () => {
      mockGetFitnessGearActivities.mockRejectedValueOnce(
        new Error('Activity service down')
      )
      renderFeed()

      const retry = await screen.findByRole('button', { name: 'Try again' })
      mockGetFitnessGearActivities.mockResolvedValueOnce(
        page({ statuses: [createStatus('status-1', 'Morning ride')] })
      )
      fireEvent.click(retry)

      expect(await screen.findByText('Morning ride')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Try again' })
      ).not.toBeInTheDocument()
    })
  })

  describe('the infinite-scroll sentinel', () => {
    // `useLoadMoreOnVisible` short-circuits when `IntersectionObserver` is
    // undefined, which it is under jsdom — so without this stub the auto-load
    // path is never reached and a click is the only way in.
    let observerCallback:
      ((entries: IntersectionObserverEntry[]) => void) | null = null
    let observe: jest.Mock

    beforeEach(() => {
      observerCallback = null
      observe = vi.fn()
      Object.defineProperty(globalThis, 'IntersectionObserver', {
        configurable: true,
        value: vi.fn().mockImplementation(function (
          callback: (entries: IntersectionObserverEntry[]) => void
        ) {
          observerCallback = callback
          return { disconnect: vi.fn(), observe }
        })
      })
    })

    afterEach(() => {
      Reflect.deleteProperty(globalThis, 'IntersectionObserver')
    })

    const scrollSentinelIntoView = () =>
      observerCallback?.([
        { isIntersecting: true } as IntersectionObserverEntry
      ])

    it('loads the next page when the sentinel scrolls into view', async () => {
      mockGetFitnessGearActivities.mockResolvedValueOnce(
        page({
          statuses: [createStatus('status-1', 'Morning ride')],
          hasMore: true,
          nextOffset: 20
        })
      )
      renderFeed()
      await screen.findByRole('button', { name: 'Load more' })

      mockGetFitnessGearActivities.mockResolvedValueOnce(
        page({ statuses: [createStatus('status-2', 'Evening ride')] })
      )
      act(() => scrollSentinelIntoView())

      await waitFor(() =>
        expect(screen.getByText('Evening ride')).toBeInTheDocument()
      )
    })

    it('fires one request when the sentinel re-intersects mid-flight', async () => {
      // The hook re-invokes on every intersection and state has not settled
      // when it does, so only the ref guard stands between two intersections
      // in one tick and two requests at the same offset — whose second page
      // would be dropped from the feed for good.
      mockGetFitnessGearActivities.mockResolvedValueOnce(
        page({
          statuses: [createStatus('status-1', 'Morning ride')],
          hasMore: true,
          nextOffset: 20
        })
      )
      renderFeed()
      await screen.findByRole('button', { name: 'Load more' })

      let resolvePage: (value: GearActivityStatusesPage) => void = () => {}
      mockGetFitnessGearActivities.mockReturnValueOnce(
        new Promise<GearActivityStatusesPage>((resolve) => {
          resolvePage = resolve
        })
      )
      act(() => scrollSentinelIntoView())
      act(() => scrollSentinelIntoView())

      expect(mockGetFitnessGearActivities).toHaveBeenCalledTimes(2)

      await act(async () => {
        resolvePage(
          page({ statuses: [createStatus('status-2', 'Evening ride')] })
        )
      })
      expect(await screen.findByText('Evening ride')).toBeInTheDocument()
    })

    it('is not armed while the first page is still loading', async () => {
      let resolveFirst: (value: GearActivityStatusesPage) => void = () => {}
      mockGetFitnessGearActivities.mockReturnValueOnce(
        new Promise<GearActivityStatusesPage>((resolve) => {
          resolveFirst = resolve
        })
      )
      renderFeed()

      expect(observe).not.toHaveBeenCalled()

      await act(async () => {
        resolveFirst(
          page({
            statuses: [createStatus('status-1', 'Morning ride')],
            hasMore: true,
            nextOffset: 20
          })
        )
      })
      await screen.findByRole('button', { name: 'Load more' })
      expect(observe).toHaveBeenCalled()
    })
  })

  describe('switching to another gear on the same mounted instance', () => {
    // The detail page renders this component at a fixed position with no
    // `key`, so navigating between two gear pages swaps `gearId` on the SAME
    // instance rather than remounting.
    const renderThenSwitch = async () => {
      let resolveStale: (value: GearActivityStatusesPage) => void = () => {}
      const stalePage = new Promise<GearActivityStatusesPage>((resolve) => {
        resolveStale = resolve
      })

      mockGetFitnessGearActivities.mockResolvedValueOnce(
        page({
          statuses: [createStatus('a-1', 'Gear A ride')],
          hasMore: true,
          nextOffset: 20
        })
      )
      const view = renderFeed()
      const loadMore = await screen.findByRole('button', { name: 'Load more' })

      // "Load more" on gear A, still in flight when the gear changes.
      mockGetFitnessGearActivities.mockReturnValueOnce(stalePage)
      fireEvent.click(loadMore)

      mockGetFitnessGearActivities.mockResolvedValueOnce(
        page({
          statuses: [createStatus('b-1', 'Gear B ride')],
          hasMore: true,
          nextOffset: 20
        })
      )
      view.rerender(
        <GearActivitiesFeed
          gearId="gear-2"
          host="llun.test"
          currentTime={FIXED_CURRENT_TIME}
          currentActor={profile}
          isMediaUploadEnabled
          emptyMessage="No recent activities on this gear."
        />
      )
      await waitFor(() =>
        expect(screen.getByText('Gear B ride')).toBeInTheDocument()
      )

      resolveStale(
        page({ statuses: [createStatus('a-2', 'Stale ride')], hasMore: true })
      )
      await waitFor(() => expect(stalePage).resolves.toBeDefined())
      return view
    }

    it('never leaves the new gear stuck loading', async () => {
      await renderThenSwitch()

      // The superseded request's `finally` is skipped, so the effect has to
      // clear this itself or the button is disabled forever.
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled()
      )
    })

    it('drops the previous gear’s page instead of appending it', async () => {
      await renderThenSwitch()

      expect(screen.getByText('Gear B ride')).toBeInTheDocument()
      expect(screen.queryByText('Stale ride')).not.toBeInTheDocument()
      expect(screen.queryByText('Gear A ride')).not.toBeInTheDocument()
    })

    it('clears the previous gear’s error', async () => {
      // Left behind, a bike's outage sits above a device's "Loading..." for
      // the whole round trip, reporting a failure the reader navigated away
      // from.
      mockGetFitnessGearActivities.mockRejectedValueOnce(
        new Error('Activity service down')
      )
      const view = renderFeed()
      await screen.findByRole('alert')

      let resolveNext: (value: GearActivityStatusesPage) => void = () => {}
      mockGetFitnessGearActivities.mockReturnValueOnce(
        new Promise<GearActivityStatusesPage>((resolve) => {
          resolveNext = resolve
        })
      )
      view.rerender(
        <GearActivitiesFeed
          gearId="gear-2"
          host="llun.test"
          currentTime={FIXED_CURRENT_TIME}
          currentActor={profile}
          isMediaUploadEnabled
          emptyMessage="No recent activities on this gear."
        />
      )

      // While the new gear is still loading, not merely once it resolves.
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()

      await act(async () => {
        resolveNext(page({ statuses: [createStatus('b-1', 'Gear B ride')] }))
      })
      expect(screen.getByText('Gear B ride')).toBeInTheDocument()
    })

    it('stops an in-flight walk when the feed unmounts', async () => {
      // The walk's liveness check reads `generationRef`, which only moves at
      // the top of the effect — so without the cleanup bumping it, a walk in
      // flight at unmount runs its remaining requests out, each a hydrated
      // page read nobody will see.
      mockGetFitnessGearActivities.mockResolvedValueOnce(
        page({
          statuses: [createStatus('a-1', 'Gear A ride')],
          hasMore: true,
          nextOffset: 20
        })
      )
      const view = renderFeed()
      const loadMore = await screen.findByRole('button', { name: 'Load more' })

      let resolveWalk: (value: GearActivityStatusesPage) => void = () => {}
      mockGetFitnessGearActivities.mockReturnValueOnce(
        new Promise<GearActivityStatusesPage>((resolve) => {
          resolveWalk = resolve
        })
      )
      fireEvent.click(loadMore)
      expect(mockGetFitnessGearActivities).toHaveBeenCalledTimes(2)

      view.unmount()
      await act(async () => {
        // A postless page, which is what would otherwise keep the walk going.
        resolveWalk(page({ hasMore: true, nextOffset: 40 }))
      })

      expect(mockGetFitnessGearActivities).toHaveBeenCalledTimes(2)
    })
  })
})
