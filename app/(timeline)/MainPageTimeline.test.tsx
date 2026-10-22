/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'

import {
  type GetTimelineResult,
  TimelineRequestError,
  getTimeline
} from '@/lib/client'
import { checkServerHealth } from '@/lib/client/health'
import {
  clearAllOfflineData,
  getOfflineTimeline,
  saveOfflineScrollAnchor,
  saveOfflineTimeline
} from '@/lib/client/offline'
import { reconcileCachedStatuses } from '@/lib/client/statuses'
import { Timeline } from '@/lib/services/timelines/types'
import { createDeferred } from '@/lib/testing/deferred'

import { MainPageTimeline } from './MainPageTimeline'
import {
  FIXED_CURRENT_TIME,
  createAnnounceStatus,
  createStatus,
  installIntersectionObserver,
  profile,
  resetConnectionSimulation,
  resetIntersectionObserver,
  simulateBackOnline,
  simulateOffline,
  simulateServerUnreachable
} from './MainPageTimeline.testUtils'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn()
  })
}))

vi.mock('@/lib/client', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/client')>('@/lib/client')
  return {
    ...actual,
    getTimeline: vi.fn()
  }
})

vi.mock('@/lib/client/offline', async () => {
  const actual = await vi.importActual<typeof import('@/lib/client/offline')>(
    '@/lib/client/offline'
  )
  return {
    ...actual,
    clearAllOfflineData: vi.fn().mockResolvedValue(undefined),
    getOfflineTimeline: vi.fn().mockResolvedValue(null),
    saveOfflineTimeline: vi.fn().mockResolvedValue(undefined),
    saveOfflineScrollAnchor: vi.fn().mockResolvedValue(undefined)
  }
})

vi.mock('@/lib/client/health', () => ({ checkServerHealth: vi.fn() }))

vi.mock('@/lib/client/statuses', () => ({
  reconcileCachedStatuses: vi.fn().mockResolvedValue({
    statuses: [],
    removedStatusIds: []
  })
}))

vi.mock('@/lib/components/announcements/useAnnouncements', () => ({
  useAnnouncements: () => ({ hasAnnouncements: true })
}))

vi.mock('@/lib/components/announcements/AnnouncementBanner', async () => {
  const utils = await import('./MainPageTimeline.testUtils')
  return {
    AnnouncementIconButton: utils.MockAnnouncementIcon
  }
})

vi.mock('@/lib/components/page-header', async () => ({
  PageHeader: (await import('./MainPageTimeline.testUtils')).MockPageHeader
}))

vi.mock('@/lib/components/post-box/post-box', () => ({
  PostBox: () => null
}))

vi.mock('@/lib/components/scroll-to-top-button', () => ({
  ScrollToTopButton: () => null
}))

vi.mock('@/lib/components/posts/posts', async () => ({
  Posts: (await import('./MainPageTimeline.testUtils')).MockFeed
}))

vi.mock('@/lib/components/posts/timeline-feed', async () => {
  const utils = await import('./MainPageTimeline.testUtils')
  const { TimelineGapRow } =
    await import('@/lib/components/posts/TimelineGapRow')
  return {
    TimelineFeed: (props: {
      gapAfterStatusIds?: Record<string, number>
      loadingGapSegmentIndex?: number | null
      onLoadGap?: (index: number) => void
      [key: string]: unknown
    }) => (
      <div>
        <utils.MockFeed {...(props as Parameters<typeof utils.MockFeed>[0])} />
        {props.gapAfterStatusIds &&
          props.onLoadGap &&
          Object.entries(props.gapAfterStatusIds).map(
            ([statusId, segmentIndex]) => (
              <TimelineGapRow
                key={statusId}
                segmentIndex={segmentIndex}
                isLoading={props.loadingGapSegmentIndex === segmentIndex}
                onLoadGap={props.onLoadGap!}
              />
            )
          )}
      </div>
    )
  }
})

vi.mock('@/lib/components/ui/button', async () => ({
  Button: (await import('./MainPageTimeline.testUtils')).MockButton
}))

describe('MainPageTimeline', () => {
  beforeAll(() => {
    installIntersectionObserver()
  })

  beforeEach(() => {
    vi.mocked(getTimeline).mockReset()
    vi.mocked(clearAllOfflineData).mockReset().mockResolvedValue(undefined)
    vi.mocked(getOfflineTimeline).mockReset().mockResolvedValue(null)
    vi.mocked(saveOfflineTimeline).mockReset().mockResolvedValue(undefined)
    vi.mocked(saveOfflineScrollAnchor).mockReset().mockResolvedValue(undefined)
    vi.mocked(reconcileCachedStatuses).mockReset().mockResolvedValue({
      statuses: [],
      removedStatusIds: []
    })
    resetIntersectionObserver()
  })

  afterEach(() => {
    resetConnectionSimulation()
  })

  it('renders posts using the currentTime prop, not a freshly computed Date.now()', () => {
    // Regression test for React hydration mismatch (error #418): relative
    // timestamps must derive from the server-provided currentTime prop so SSR
    // and client-hydration output match. Computing Date.now() inside this
    // client component yields a different value on the client and breaks
    // hydration.
    const dateNowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValue(FIXED_CURRENT_TIME + 5 * 60 * 1000)

    try {
      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[createStatus('https://activities.local/users/llun/s/1')]}
        />
      )

      const renderedTimes = screen.getAllByTestId('posts-current-time')
      expect(renderedTimes.length).toBeGreaterThan(0)
      for (const node of renderedTimes) {
        expect(node).toHaveTextContent(String(FIXED_CURRENT_TIME))
      }
    } finally {
      dateNowSpy.mockRestore()
    }
  })

  // Announcements never add a node to the header's layout: the icon is a
  // header action beside Refresh, and nothing of them floats in the bottom slot.
  it('hands the announcement icon to the header actions, not the floating row', () => {
    render(
      <MainPageTimeline
        host="activities.local"
        currentTime={FIXED_CURRENT_TIME}
        profile={profile}
        isMediaUploadEnabled={false}
        statuses={[]}
      />
    )

    expect(
      within(screen.getByTestId('header-actions')).getByTestId(
        'announcement-icon'
      )
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId('header-bottom-slot')).queryByTestId(
        'announcement-icon'
      )
    ).not.toBeInTheDocument()
  })

  // Below md Refresh sits in the compact bar and the full-bleed composer meets
  // the bar's hairline; PageHeader owns that geometry.
  it('asks the page header for a flush composer and bar Refresh', () => {
    render(
      <MainPageTimeline
        host="activities.local"
        currentTime={FIXED_CURRENT_TIME}
        profile={profile}
        isMediaUploadEnabled={false}
        statuses={[]}
      />
    )

    expect(screen.getByTestId('page-header')).toHaveAttribute(
      'data-flush-on-mobile',
      'true'
    )
    expect(screen.getByTestId('page-header')).toHaveAttribute(
      'data-actions-in-mobile-bar',
      'true'
    )
  })

  it('removes a direct post from the feed when delete callback is invoked', () => {
    const post1 = createStatus('https://activities.local/users/llun/s/1')
    const post2 = createStatus('https://activities.local/users/llun/s/2')

    render(
      <MainPageTimeline
        host="activities.local"
        currentTime={FIXED_CURRENT_TIME}
        profile={profile}
        isMediaUploadEnabled={false}
        statuses={[post1, post2]}
      />
    )

    expect(
      screen.getByTestId('post-https://activities.local/users/llun/s/1')
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('post-https://activities.local/users/llun/s/2')
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByTestId(
        'trigger-delete-https://activities.local/users/llun/s/1'
      )
    )

    expect(
      screen.queryByTestId('post-https://activities.local/users/llun/s/1')
    ).not.toBeInTheDocument()
    expect(
      screen.getByTestId('post-https://activities.local/users/llun/s/2')
    ).toBeInTheDocument()
  })

  it('removes a displayed boost wrapper when its original status is deleted', () => {
    const post1 = createStatus('https://activities.local/users/llun/s/1')
    const original2 = createStatus('https://activities.local/users/llun/s/2')
    const boost2 = createAnnounceStatus(
      'https://activities.local/users/llun/s/boost-2',
      original2
    )

    render(
      <MainPageTimeline
        host="activities.local"
        currentTime={FIXED_CURRENT_TIME}
        profile={profile}
        isMediaUploadEnabled={false}
        statuses={[post1, boost2]}
      />
    )

    expect(
      screen.getByTestId('post-https://activities.local/users/llun/s/boost-2')
    ).toBeInTheDocument()

    // Trigger delete with original2 (the boosted original)
    fireEvent.click(
      screen.getByTestId(
        'trigger-delete-target-https://activities.local/users/llun/s/boost-2'
      )
    )

    expect(
      screen.queryByTestId('post-https://activities.local/users/llun/s/boost-2')
    ).not.toBeInTheDocument()
    expect(
      screen.getByTestId('post-https://activities.local/users/llun/s/1')
    ).toBeInTheDocument()
  })

  it('removes a post when delete callback receives a different object instance with the same ID', () => {
    const post1 = createStatus('https://activities.local/users/llun/s/1')
    const post2 = createStatus('https://activities.local/users/llun/s/2')

    render(
      <MainPageTimeline
        host="activities.local"
        currentTime={FIXED_CURRENT_TIME}
        profile={profile}
        isMediaUploadEnabled={false}
        statuses={[post1, post2]}
      />
    )

    // Trigger delete clone (different object instance, identical ID)
    fireEvent.click(
      screen.getByTestId(
        'trigger-delete-clone-https://activities.local/users/llun/s/1'
      )
    )

    expect(
      screen.queryByTestId('post-https://activities.local/users/llun/s/1')
    ).not.toBeInTheDocument()
    expect(
      screen.getByTestId('post-https://activities.local/users/llun/s/2')
    ).toBeInTheDocument()
  })

  it('leaves the feed unchanged when an unknown ID is deleted', () => {
    const post1 = createStatus('https://activities.local/users/llun/s/1')
    const post2 = createStatus('https://activities.local/users/llun/s/2')

    render(
      <MainPageTimeline
        host="activities.local"
        currentTime={FIXED_CURRENT_TIME}
        profile={profile}
        isMediaUploadEnabled={false}
        statuses={[post1, post2]}
      />
    )

    fireEvent.click(screen.getByTestId('trigger-delete-unknown'))

    expect(
      screen.getByTestId('post-https://activities.local/users/llun/s/1')
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('post-https://activities.local/users/llun/s/2')
    ).toBeInTheDocument()
  })

  it('preserves unrelated rows, ordering, and concurrent updates', () => {
    const post1 = createStatus('https://activities.local/users/llun/s/1')
    const post2 = createStatus('https://activities.local/users/llun/s/2')
    const post3 = createStatus('https://activities.local/users/llun/s/3')

    render(
      <MainPageTimeline
        host="activities.local"
        currentTime={FIXED_CURRENT_TIME}
        profile={profile}
        isMediaUploadEnabled={false}
        statuses={[post1, post2, post3]}
      />
    )

    // Delete post2 then post1 in succession (concurrent updates)
    fireEvent.click(
      screen.getByTestId(
        'trigger-delete-https://activities.local/users/llun/s/2'
      )
    )
    fireEvent.click(
      screen.getByTestId(
        'trigger-delete-https://activities.local/users/llun/s/1'
      )
    )

    expect(
      screen.queryByTestId('post-https://activities.local/users/llun/s/1')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('post-https://activities.local/users/llun/s/2')
    ).not.toBeInTheDocument()
    expect(
      screen.getByTestId('post-https://activities.local/users/llun/s/3')
    ).toBeInTheDocument()
  })

  it('preserves the server-provided pagination cursor and fetches the next page after deletion', async () => {
    const post1 = createStatus('https://activities.local/users/llun/s/1')
    const post2 = createStatus('https://activities.local/users/llun/s/2')
    const post3 = createStatus('https://activities.local/users/llun/s/3')

    vi.mocked(getTimeline).mockResolvedValueOnce({
      statuses: [post3],
      nextMaxStatusId: 'cursor-server-page-2',
      prevMinStatusId: null
    })

    render(
      <MainPageTimeline
        host="activities.local"
        currentTime={FIXED_CURRENT_TIME}
        profile={profile}
        isMediaUploadEnabled={false}
        statuses={[post1, post2]}
        initialNextMaxStatusId="cursor-server-page-1"
      />
    )

    // Delete the last visible item (post2)
    fireEvent.click(
      screen.getByTestId(
        'trigger-delete-https://activities.local/users/llun/s/2'
      )
    )

    expect(
      screen.queryByTestId('post-https://activities.local/users/llun/s/2')
    ).not.toBeInTheDocument()
    expect(
      screen.getByTestId('post-https://activities.local/users/llun/s/1')
    ).toBeInTheDocument()

    // Click Load more to fetch next page
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() => {
      expect(getTimeline).toHaveBeenCalledTimes(1)
    })

    // The cursor MUST be the server-provided 'cursor-server-page-1', NOT replaced with post1.id!
    expect(getTimeline).toHaveBeenCalledWith({
      timeline: Timeline.MAIN,
      maxStatusId: 'cursor-server-page-1'
    })

    // Next page post3 should now be rendered
    await waitFor(() => {
      expect(
        screen.getByTestId('post-https://activities.local/users/llun/s/3')
      ).toBeInTheDocument()
    })
    expect(
      screen.getByTestId('post-https://activities.local/users/llun/s/1')
    ).toBeInTheDocument()
  })

  it('allows fetching the next page after all visible items are deleted', async () => {
    const post1 = createStatus('https://activities.local/users/llun/s/1')
    const post2 = createStatus('https://activities.local/users/llun/s/2')

    vi.mocked(getTimeline).mockResolvedValueOnce({
      statuses: [post2],
      nextMaxStatusId: null,
      prevMinStatusId: null
    })

    render(
      <MainPageTimeline
        host="activities.local"
        currentTime={FIXED_CURRENT_TIME}
        profile={profile}
        isMediaUploadEnabled={false}
        statuses={[post1]}
        initialNextMaxStatusId="cursor-page-1"
      />
    )

    // Delete the only visible item
    fireEvent.click(
      screen.getByTestId(
        'trigger-delete-https://activities.local/users/llun/s/1'
      )
    )

    expect(
      screen.queryByTestId('post-https://activities.local/users/llun/s/1')
    ).not.toBeInTheDocument()

    // Load more should still be available with the server-provided cursor
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() => {
      expect(getTimeline).toHaveBeenCalledTimes(1)
    })

    expect(getTimeline).toHaveBeenCalledWith({
      timeline: Timeline.MAIN,
      maxStatusId: 'cursor-page-1'
    })

    await waitFor(() => {
      expect(
        screen.getByTestId('post-https://activities.local/users/llun/s/2')
      ).toBeInTheDocument()
    })
  })

  describe('status updates and engagement sync', () => {
    it('updates matching status in place on onPostUpdated', () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[post1]}
        />
      )

      expect(
        screen.getByTestId('post-text-https://activities.local/users/llun/s/1')
      ).toHaveTextContent('https://activities.local/users/llun/s/1')

      fireEvent.click(
        screen.getByTestId(
          'trigger-update-https://activities.local/users/llun/s/1'
        )
      )

      expect(
        screen.getByTestId('post-text-https://activities.local/users/llun/s/1')
      ).toHaveTextContent('updated text')
    })

    it('updates announce wrapper when original post is updated', () => {
      const original = createStatus('https://activities.local/users/other/s/1')
      const announce = createAnnounceStatus(
        'https://activities.local/users/llun/s/announce-1',
        original
      )

      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[announce]}
        />
      )

      expect(
        screen.getByTestId(
          'post-text-https://activities.local/users/llun/s/announce-1'
        )
      ).toHaveTextContent('https://activities.local/users/other/s/1')

      fireEvent.click(
        screen.getByTestId(
          'trigger-update-https://activities.local/users/llun/s/announce-1'
        )
      )

      expect(
        screen.getByTestId(
          'post-text-https://activities.local/users/llun/s/announce-1'
        )
      ).toHaveTextContent('updated text')
    })

    it('updates like count and liked status when onLikeChanged is triggered', () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[post1]}
        />
      )

      expect(
        screen.getByTestId('post-liked-https://activities.local/users/llun/s/1')
      ).toHaveTextContent('false')
      expect(
        screen.getByTestId('post-likes-https://activities.local/users/llun/s/1')
      ).toHaveTextContent('0')

      fireEvent.click(
        screen.getByTestId(
          'trigger-like-https://activities.local/users/llun/s/1'
        )
      )

      expect(
        screen.getByTestId('post-liked-https://activities.local/users/llun/s/1')
      ).toHaveTextContent('true')
      expect(
        screen.getByTestId('post-likes-https://activities.local/users/llun/s/1')
      ).toHaveTextContent('1')

      fireEvent.click(
        screen.getByTestId(
          'trigger-unlike-https://activities.local/users/llun/s/1'
        )
      )

      expect(
        screen.getByTestId('post-liked-https://activities.local/users/llun/s/1')
      ).toHaveTextContent('false')
      expect(
        screen.getByTestId('post-likes-https://activities.local/users/llun/s/1')
      ).toHaveTextContent('0')
    })

    it('updates bookmark status when onBookmarkChanged is triggered', () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[post1]}
        />
      )

      expect(
        screen.getByTestId(
          'post-bookmarked-https://activities.local/users/llun/s/1'
        )
      ).toHaveTextContent('false')

      fireEvent.click(
        screen.getByTestId(
          'trigger-bookmark-https://activities.local/users/llun/s/1'
        )
      )

      expect(
        screen.getByTestId(
          'post-bookmarked-https://activities.local/users/llun/s/1'
        )
      ).toHaveTextContent('true')

      fireEvent.click(
        screen.getByTestId(
          'trigger-unbookmark-https://activities.local/users/llun/s/1'
        )
      )

      expect(
        screen.getByTestId(
          'post-bookmarked-https://activities.local/users/llun/s/1'
        )
      ).toHaveTextContent('false')
    })

    it('updates reactions when onReactionsChanged is triggered', () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[post1]}
        />
      )

      expect(
        screen.getByTestId(
          'post-reactions-https://activities.local/users/llun/s/1'
        )
      ).toHaveTextContent('0')

      fireEvent.click(
        screen.getByTestId(
          'trigger-react-https://activities.local/users/llun/s/1'
        )
      )

      expect(
        screen.getByTestId(
          'post-reactions-https://activities.local/users/llun/s/1'
        )
      ).toHaveTextContent('1')
    })

    it('increments target status totalReplies, inserts reply directly next to target status in feed, and displays ReplyToast', () => {
      const targetStatus = createStatus(
        'https://activities.local/users/llun/s/1'
      )
      render(
        <MainPageTimeline
          host="activities.local"
          profile={profile}
          currentTime={1000}
          isMediaUploadEnabled={false}
          statuses={[targetStatus]}
        />
      )

      expect(
        screen.getByTestId(
          'post-replies-https://activities.local/users/llun/s/1'
        )
      ).toHaveTextContent('0')

      // Trigger reply creation
      fireEvent.click(
        screen.getByTestId(
          'trigger-reply-https://activities.local/users/llun/s/1'
        )
      )

      expect(
        screen.getByTestId(
          'post-replies-https://activities.local/users/llun/s/1'
        )
      ).toHaveTextContent('1')

      // Reply is inserted directly next to target status in feed
      expect(
        screen.getByTestId(
          'post-https://activities.local/users/other/statuses/reply-to-https://activities.local/users/llun/s/1'
        )
      ).toBeInTheDocument()

      // ReplyToast is displayed
      expect(screen.getByText('Reply posted')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'View reply' })
      ).toBeInTheDocument()
    })
  })

  describe('offline persistence and refresh', () => {
    it('preserves older loaded pages when refreshTimeline runs', async () => {
      const post0 = createStatus('https://activities.local/users/llun/s/0')
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      const post2 = createStatus('https://activities.local/users/llun/s/2')
      const post3 = createStatus('https://activities.local/users/llun/s/3')

      vi.mocked(getTimeline).mockResolvedValueOnce({
        statuses: [post0, post1],
        nextMaxStatusId: post2.id,
        prevMinStatusId: post0.id
      })

      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[post1, post2]}
          initialSegments={[
            {
              statuses: [post1, post2],
              nextMaxStatusId: post3.id,
              prevMinStatusId: post1.id
            },
            {
              statuses: [post3],
              nextMaxStatusId: null,
              prevMinStatusId: post3.id
            }
          ]}
        />
      )

      expect(screen.getByTestId('post-' + post1.id)).toBeInTheDocument()
      expect(screen.getByTestId('post-' + post2.id)).toBeInTheDocument()
      expect(screen.getByTestId('post-' + post3.id)).toBeInTheDocument()

      const refreshButton = screen.getByRole('button', {
        name: 'Refresh timeline'
      })
      fireEvent.click(refreshButton)

      await waitFor(() => {
        expect(screen.getByTestId('post-' + post0.id)).toBeInTheDocument()
      })
      expect(screen.getByTestId('post-' + post1.id)).toBeInTheDocument()
      expect(screen.getByTestId('post-' + post2.id)).toBeInTheDocument()
      expect(screen.getByTestId('post-' + post3.id)).toBeInTheDocument()
    })

    it('creates and bridges a TimelineGapRow when a refresh returns non-overlapping newer posts', async () => {
      const post0 = createStatus('https://activities.local/users/llun/s/0')
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      const post2 = createStatus('https://activities.local/users/llun/s/2')
      const post3 = createStatus('https://activities.local/users/llun/s/3')

      // Refresh returns post0 with cursor "cursor-gap", which does not overlap with post2
      vi.mocked(getTimeline).mockResolvedValueOnce({
        statuses: [post0],
        nextMaxStatusId: 'cursor-gap',
        prevMinStatusId: post0.id
      })

      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[post2, post3]}
        />
      )

      const refreshButton = screen.getByRole('button', {
        name: 'Refresh timeline'
      })
      fireEvent.click(refreshButton)

      // Post 0 is added, and gap row appears because post0 does not overlap with post2
      await waitFor(() => {
        expect(screen.getByTestId('post-' + post0.id)).toBeInTheDocument()
      })
      const loadGapButton = await screen.findByRole('button', {
        name: /load missing posts/i
      })
      expect(loadGapButton).toBeInTheDocument()

      // When clicking Load missing posts, it fetches with maxStatusId: 'cursor-gap'
      vi.mocked(getTimeline).mockResolvedValueOnce({
        statuses: [post1],
        nextMaxStatusId: post2.id,
        prevMinStatusId: post1.id
      })

      fireEvent.click(loadGapButton)

      await waitFor(() => {
        expect(getTimeline).toHaveBeenCalledWith({
          timeline: Timeline.MAIN,
          maxStatusId: 'cursor-gap'
        })
      })

      // The gap bridges and all posts are in the feed, gap row is removed
      await waitFor(() => {
        expect(screen.getByTestId('post-' + post1.id)).toBeInTheDocument()
      })
      expect(screen.getByTestId('post-' + post0.id)).toBeInTheDocument()
      expect(screen.getByTestId('post-' + post2.id)).toBeInTheDocument()
      expect(screen.getByTestId('post-' + post3.id)).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /load missing posts/i })
      ).not.toBeInTheDocument()
    })

    it('preserves cached posts and cursors when getTimeline rejects with TimelineRequestError', async () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      const post2 = createStatus('https://activities.local/users/llun/s/2')

      vi.mocked(getTimeline).mockRejectedValueOnce(
        new TimelineRequestError('Network error', 500)
      )

      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[post1, post2]}
          initialNextMaxStatusId="cursor-1"
        />
      )

      const refreshButton = screen.getByRole('button', {
        name: 'Refresh timeline'
      })
      fireEvent.click(refreshButton)

      await waitFor(() => {
        expect(screen.getByText('Failed to load posts')).toBeInTheDocument()
      })

      // Cached posts and pagination cursor are preserved
      expect(screen.getByTestId('post-' + post1.id)).toBeInTheDocument()
      expect(screen.getByTestId('post-' + post2.id)).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Load more' })
      ).toBeInTheDocument()
    })

    it('clears offline cache and calls onUnauthorized on 401 TimelineRequestError', async () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      const onUnauthorized = vi.fn()

      vi.mocked(getTimeline).mockRejectedValueOnce(
        new TimelineRequestError('Unauthorized', 401)
      )

      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[post1]}
          onUnauthorized={onUnauthorized}
        />
      )

      const refreshButton = screen.getByRole('button', {
        name: 'Refresh timeline'
      })
      fireEvent.click(refreshButton)

      await waitFor(() => {
        expect(clearAllOfflineData).toHaveBeenCalledTimes(1)
        expect(onUnauthorized).toHaveBeenCalledTimes(1)
        expect(
          screen.getByText('Session expired. Please sign in again.')
        ).toBeInTheDocument()
      })
    })

    it('reconciles cached statuses and removes deleted posts from older cached pages', async () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      const post2 = createStatus('https://activities.local/users/llun/s/2')

      vi.mocked(reconcileCachedStatuses).mockResolvedValueOnce({
        statuses: [],
        removedStatusIds: [post2.id]
      })

      vi.mocked(getTimeline).mockResolvedValueOnce({
        statuses: [post1],
        nextMaxStatusId: null,
        prevMinStatusId: post1.id
      })

      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[post1, post2]}
        />
      )

      expect(screen.getByTestId('post-' + post2.id)).toBeInTheDocument()

      const refreshButton = screen.getByRole('button', {
        name: 'Refresh timeline'
      })
      fireEvent.click(refreshButton)

      await waitFor(() => {
        expect(reconcileCachedStatuses).toHaveBeenCalledWith({
          statusIds: [post2.id]
        })
      })

      await waitFor(() => {
        expect(screen.queryByTestId('post-' + post2.id)).not.toBeInTheDocument()
      })
      expect(screen.getByTestId('post-' + post1.id)).toBeInTheDocument()
    })

    describe('scroll anchor hydration', () => {
      afterEach(() => {
        vi.restoreAllMocks()
      })

      const cachedTimeline = (anchorId: string) => {
        const a = createStatus('https://activities.local/users/llun/s/cached-a')
        const b = createStatus('https://activities.local/users/llun/s/cached-b')
        return {
          actorId: profile.id,
          timeline: 'home',
          filterKey: '',
          statuses: [a, b],
          segments: [
            {
              statuses: [a, b],
              nextMaxStatusId: 'cursor-cached',
              prevMinStatusId: a.id
            }
          ],
          ancestorsById: {},
          lastRefreshedAt: FIXED_CURRENT_TIME,
          scrollAnchor: { statusId: anchorId, offsetTop: 500, updatedAt: 1 }
        } as unknown as Awaited<ReturnType<typeof getOfflineTimeline>>
      }

      it('restores a cached scroll anchor that the cache holds', async () => {
        const scrollBy = vi
          .spyOn(window, 'scrollBy')
          .mockImplementation(() => undefined)
        vi.mocked(getOfflineTimeline).mockResolvedValue(
          cachedTimeline('https://activities.local/users/llun/s/cached-b')
        )

        render(
          <MainPageTimeline
            host="activities.local"
            currentTime={FIXED_CURRENT_TIME}
            profile={profile}
            isMediaUploadEnabled={false}
            statuses={[
              createStatus('https://activities.local/users/llun/s/fresh')
            ]}
            initialNextMaxStatusId="cursor-fresh"
          />
        )

        await waitFor(() => {
          expect(scrollBy).toHaveBeenCalled()
        })
      })

      it('clears a pending scroll anchor once the reader loads more', async () => {
        const scrollBy = vi
          .spyOn(window, 'scrollBy')
          .mockImplementation(() => undefined)
        const first = createStatus(
          'https://activities.local/users/llun/s/first'
        )
        const deep = createStatus('https://activities.local/users/llun/s/deep')
        vi.mocked(getTimeline).mockResolvedValue({
          statuses: [deep],
          nextMaxStatusId: null,
          prevMinStatusId: null
        })

        render(
          <MainPageTimeline
            host="activities.local"
            currentTime={FIXED_CURRENT_TIME}
            profile={profile}
            isMediaUploadEnabled={false}
            statuses={[first]}
            initialSegments={[
              {
                statuses: [first],
                nextMaxStatusId: 'cursor-1',
                prevMinStatusId: first.id
              }
            ]}
            initialScrollAnchor={{
              statusId: deep.id,
              offsetTop: 500,
              updatedAt: 1
            }}
          />
        )

        fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

        await waitFor(() => {
          expect(screen.getByTestId('post-' + deep.id)).toBeInTheDocument()
        })
        expect(scrollBy).not.toHaveBeenCalled()
      })

      it('does not anchor or scroll down on refreshOnMount when at the top of the timeline', async () => {
        const scrollBy = vi
          .spyOn(window, 'scrollBy')
          .mockImplementation(() => undefined)
        const post1 = createStatus('https://activities.local/users/llun/s/1')
        const post0 = createStatus('https://activities.local/users/llun/s/0')
        vi.mocked(getTimeline).mockResolvedValueOnce({
          statuses: [post0, post1],
          nextMaxStatusId: null,
          prevMinStatusId: post0.id
        })

        render(
          <MainPageTimeline
            host="activities.local"
            currentTime={FIXED_CURRENT_TIME}
            profile={profile}
            isMediaUploadEnabled={false}
            statuses={[post1]}
            initialSegments={[
              {
                statuses: [post1],
                nextMaxStatusId: null,
                prevMinStatusId: post1.id
              }
            ]}
            initialScrollAnchor={{
              statusId: post1.id,
              offsetTop: 310,
              updatedAt: 1
            }}
            refreshOnMount={true}
          />
        )

        await waitFor(() => {
          expect(screen.getByTestId('post-' + post0.id)).toBeInTheDocument()
        })
        expect(scrollBy).not.toHaveBeenCalled()
        expect(
          screen.queryByRole('button', { name: /new post|Back to top/ })
        ).not.toBeInTheDocument()
      })

      it('saves scrollAnchor: null while first post is below header (even if scrolled into composer) and saves unclamped offsetTop once scrolled into feed', () => {
        const post1 = createStatus('https://activities.local/users/llun/s/1')
        const originalRect = HTMLElement.prototype.getBoundingClientRect
        const originalScrollY = window.scrollY
        let currentTop = 210
        HTMLElement.prototype.getBoundingClientRect = function () {
          return {
            top: currentTop,
            bottom: currentTop + 100,
            left: 0,
            right: 0,
            width: 0,
            height: 100,
            x: 0,
            y: currentTop,
            toJSON: () => ({})
          } as DOMRect
        }

        try {
          Object.defineProperty(window, 'scrollY', {
            value: 100,
            configurable: true,
            writable: true
          })

          render(
            <MainPageTimeline
              host="activities.local"
              currentTime={FIXED_CURRENT_TIME}
              profile={profile}
              isMediaUploadEnabled={false}
              statuses={[post1]}
            />
          )

          vi.mocked(saveOfflineScrollAnchor).mockClear()
          Object.defineProperty(document, 'visibilityState', {
            value: 'hidden',
            configurable: true
          })
          fireEvent(document, new Event('visibilitychange'))

          expect(saveOfflineScrollAnchor).toHaveBeenCalledWith({
            actorId: profile.id,
            timeline: 'home',
            scrollAnchor: null
          })

          // Once scrolled into post1 (top <= 80), saves the true offsetTop
          currentTop = 60
          vi.mocked(saveOfflineScrollAnchor).mockClear()
          fireEvent(document, new Event('visibilitychange'))

          expect(saveOfflineScrollAnchor).toHaveBeenCalledWith({
            actorId: profile.id,
            timeline: 'home',
            scrollAnchor: expect.objectContaining({
              statusId: post1.id,
              offsetTop: 60
            })
          })
        } finally {
          HTMLElement.prototype.getBoundingClientRect = originalRect
          Object.defineProperty(window, 'scrollY', {
            value: originalScrollY,
            configurable: true,
            writable: true
          })
          Object.defineProperty(document, 'visibilityState', {
            value: 'visible',
            configurable: true
          })
        }
      })

      it('renders "Back to top" pill when restored to a mid-feed scroll anchor and clears it on click', async () => {
        vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)
        const scrollTo = vi
          .spyOn(window, 'scrollTo')
          .mockImplementation(() => undefined)
        const post1 = createStatus('https://activities.local/users/llun/s/1')
        const post2 = createStatus('https://activities.local/users/llun/s/2')

        render(
          <MainPageTimeline
            host="activities.local"
            currentTime={FIXED_CURRENT_TIME}
            profile={profile}
            isMediaUploadEnabled={false}
            statuses={[post1, post2]}
            initialSegments={[
              {
                statuses: [post1, post2],
                nextMaxStatusId: null,
                prevMinStatusId: post1.id
              }
            ]}
            initialScrollAnchor={{
              statusId: post2.id,
              offsetTop: 80,
              updatedAt: 1
            }}
          />
        )

        const pill = await screen.findByRole('button', { name: 'Back to top' })
        expect(pill).toBeInTheDocument()

        vi.mocked(saveOfflineScrollAnchor).mockClear()
        fireEvent.click(pill)

        expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
        expect(saveOfflineScrollAnchor).toHaveBeenCalledWith({
          actorId: profile.id,
          timeline: 'home',
          scrollAnchor: null
        })
        expect(
          screen.queryByRole('button', { name: 'Back to top' })
        ).not.toBeInTheDocument()
      })

      it('restores a cached scrollAnchor from a single-page offline cache without overwriting it on mount', async () => {
        const scrollBy = vi
          .spyOn(window, 'scrollBy')
          .mockImplementation(() => undefined)
        const post1 = createStatus('https://activities.local/users/llun/s/1')
        const post2 = createStatus('https://activities.local/users/llun/s/2')

        vi.mocked(getOfflineTimeline).mockResolvedValueOnce({
          actorId: profile.id,
          timeline: 'home',
          filterKey: 'all',
          statuses: [post1, post2],
          segments: [
            {
              statuses: [post1, post2],
              nextMaxStatusId: null,
              prevMinStatusId: post1.id
            }
          ],
          ancestorsById: {},
          nextMaxStatusId: null,
          lastRefreshedAt: FIXED_CURRENT_TIME,
          scrollAnchor: {
            statusId: post2.id,
            offsetTop: 80,
            updatedAt: 1
          }
        })

        render(
          <MainPageTimeline
            host="activities.local"
            currentTime={FIXED_CURRENT_TIME}
            profile={profile}
            isMediaUploadEnabled={false}
            statuses={[post1, post2]}
          />
        )

        const pill = await screen.findByRole('button', { name: 'Back to top' })
        expect(pill).toBeInTheDocument()
        expect(scrollBy).toHaveBeenCalledWith({
          top: -80,
          behavior: 'instant'
        })
        expect(saveOfflineTimeline).not.toHaveBeenCalledWith(
          expect.objectContaining({
            scrollAnchor: null
          })
        )
        expect(saveOfflineTimeline).toHaveBeenCalledWith(
          expect.objectContaining({
            actorId: profile.id,
            timeline: 'home',
            scrollAnchor: expect.objectContaining({
              statusId: post2.id,
              offsetTop: 80
            })
          })
        )
      })

      it('ignores an in-flight refresh capture and intermediate smooth-scroll events after clicking "Back to top"', async () => {
        const scrollBy = vi
          .spyOn(window, 'scrollBy')
          .mockImplementation(() => undefined)
        vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
        const post1 = createStatus('https://activities.local/users/llun/s/1')
        const post2 = createStatus('https://activities.local/users/llun/s/2')
        const post0 = createStatus('https://activities.local/users/llun/s/0')

        const deferred = createDeferred<GetTimelineResult>()
        vi.mocked(getTimeline).mockReturnValueOnce(deferred.promise)

        const originalScrollY = window.scrollY
        const originalRect = HTMLElement.prototype.getBoundingClientRect
        const originalRaf = window.requestAnimationFrame
        let rowTops: Record<string, number> = {
          [post1.id]: -200,
          [post2.id]: 120
        }
        HTMLElement.prototype.getBoundingClientRect = function () {
          const id = this.getAttribute('data-status-id')
          const top = id && id in rowTops ? rowTops[id] : 0
          return {
            top,
            bottom: top + 100,
            left: 0,
            right: 0,
            width: 0,
            height: 100,
            x: 0,
            y: top,
            toJSON: () => ({})
          } as DOMRect
        }
        window.requestAnimationFrame = (callback: FrameRequestCallback) => {
          callback(0)
          return 1
        }
        Object.defineProperty(window, 'scrollY', {
          value: 400,
          configurable: true,
          writable: true
        })

        try {
          render(
            <MainPageTimeline
              host="activities.local"
              currentTime={FIXED_CURRENT_TIME}
              profile={profile}
              isMediaUploadEnabled={false}
              statuses={[post1, post2]}
              initialSegments={[
                {
                  statuses: [post1, post2],
                  nextMaxStatusId: null,
                  prevMinStatusId: post1.id
                }
              ]}
              initialScrollAnchor={{
                statusId: post2.id,
                offsetTop: 80,
                updatedAt: 1
              }}
            />
          )

          const pill = await screen.findByRole('button', {
            name: 'Back to top'
          })
          scrollBy.mockClear()

          // Trigger an online refresh while scrolled down at scrollY = 400
          // (captures post2 at top: 120, bottom: 220 > 80)
          await simulateOffline()
          await simulateBackOnline()

          // User clicks "Back to top" while refresh is still in flight
          fireEvent.click(pill)
          expect(
            screen.queryByRole('button', { name: /new post|Back to top/ })
          ).not.toBeInTheDocument()

          // Simulate intermediate smooth-scroll event still above 80px moving upward
          Object.defineProperty(window, 'scrollY', {
            value: 250,
            configurable: true,
            writable: true
          })
          fireEvent.scroll(window)
          expect(
            screen.queryByRole('button', { name: /new post|Back to top/ })
          ).not.toBeInTheDocument()

          // Settle the in-flight refresh with a newer post
          rowTops = {
            [post0.id]: 310,
            [post1.id]: 410,
            [post2.id]: 510
          }
          deferred.resolve({
            statuses: [post0, post1, post2],
            nextMaxStatusId: null,
            prevMinStatusId: post0.id
          })

          await waitFor(() => {
            expect(screen.getByTestId('post-' + post0.id)).toBeInTheDocument()
          })

          expect(scrollBy).not.toHaveBeenCalled()
          expect(
            screen.queryByRole('button', { name: /new post|Back to top/ })
          ).not.toBeInTheDocument()
        } finally {
          HTMLElement.prototype.getBoundingClientRect = originalRect
          window.requestAnimationFrame = originalRaf
          Object.defineProperty(window, 'scrollY', {
            value: originalScrollY,
            configurable: true,
            writable: true
          })
        }
      })
    })

    it('uses partition key timeline: "home" when loading and persisting offline timeline', async () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')

      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[post1]}
        />
      )

      await waitFor(() => {
        expect(getOfflineTimeline).toHaveBeenCalledWith({
          actorId: profile.id,
          timeline: 'home'
        })
      })

      await waitFor(() => {
        expect(saveOfflineTimeline).toHaveBeenCalledWith(
          expect.objectContaining({
            actorId: profile.id,
            timeline: 'home'
          })
        )
      })
    })

    it('shows the "Updated …" freshness line only while not online, with no status pill of its own', async () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')

      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[post1]}
          initialLastRefreshedAt={FIXED_CURRENT_TIME - 2 * 60 * 1000}
        />
      )

      expect(screen.queryByText(/Updated/)).not.toBeInTheDocument()

      await simulateOffline()
      expect(screen.getByText('Updated 2m ago')).toBeInTheDocument()
      // The connection bar and strip own the announcement; the timeline adds
      // no live region of its own.
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(screen.queryByText(/Offline/)).not.toBeInTheDocument()

      await simulateBackOnline()
      expect(screen.queryByText(/Updated/)).not.toBeInTheDocument()
    })

    it('shows the freshness line when the server is unreachable too', async () => {
      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[createStatus('https://activities.local/users/llun/s/1')]}
          initialLastRefreshedAt={FIXED_CURRENT_TIME - 2 * 60 * 1000}
        />
      )

      await simulateServerUnreachable()

      expect(screen.getByText('Updated 2m ago')).toBeInTheDocument()
    })

    it('hands a failed load-more to the connection store, so a network error triggers a probe', async () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      vi.mocked(getTimeline).mockRejectedValue(new TypeError('Load failed'))

      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[post1]}
          initialNextMaxStatusId="cursor-1"
        />
      )

      fireEvent.click(await screen.findByRole('button', { name: /load more/i }))

      await waitFor(() => expect(checkServerHealth).toHaveBeenCalled())
      expect(
        await screen.findByText('Failed to load posts')
      ).toBeInTheDocument()
    })

    it('does not probe for a failure that is not network-shaped', async () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      vi.mocked(getTimeline).mockRejectedValue(new Error('boom'))

      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[post1]}
          initialNextMaxStatusId="cursor-1"
        />
      )

      fireEvent.click(await screen.findByRole('button', { name: /load more/i }))

      expect(
        await screen.findByText('Failed to load posts')
      ).toBeInTheDocument()
      expect(checkServerHealth).not.toHaveBeenCalled()
    })

    it('renders skeleton on initial mount when refreshOnMount is true and statuses is empty, then transitions when fetch settles', async () => {
      const deferred = createDeferred<GetTimelineResult>()
      vi.mocked(getTimeline).mockReturnValue(deferred.promise)

      const post1 = createStatus('https://activities.local/users/llun/s/1')

      const { container } = render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[]}
          refreshOnMount={true}
        />
      )

      expect(
        container.querySelector('[data-slot="post-list-skeleton"]')
      ).toBeInTheDocument()
      expect(
        screen.queryByText('Your timeline is empty')
      ).not.toBeInTheDocument()

      deferred.resolve({
        statuses: [post1],
        nextMaxStatusId: null,
        prevMinStatusId: null
      })

      await waitFor(() => {
        expect(
          screen.getByTestId('post-https://activities.local/users/llun/s/1')
        ).toBeInTheDocument()
      })
      expect(
        container.querySelector('[data-slot="post-list-skeleton"]')
      ).not.toBeInTheDocument()
      expect(
        screen.queryByText('Your timeline is empty')
      ).not.toBeInTheDocument()
    })

    it('renders skeleton on initial mount when refreshOnMount is true and statuses is empty, then transitions to empty state on empty result', async () => {
      const deferred = createDeferred<GetTimelineResult>()
      vi.mocked(getTimeline).mockReturnValue(deferred.promise)

      const { container } = render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[]}
          refreshOnMount={true}
        />
      )

      expect(
        container.querySelector('[data-slot="post-list-skeleton"]')
      ).toBeInTheDocument()
      expect(
        screen.queryByText('Your timeline is empty')
      ).not.toBeInTheDocument()

      deferred.resolve({
        statuses: [],
        nextMaxStatusId: null,
        prevMinStatusId: null
      })

      await waitFor(() => {
        expect(screen.getByText('Your timeline is empty')).toBeInTheDocument()
      })
      expect(
        container.querySelector('[data-slot="post-list-skeleton"]')
      ).not.toBeInTheDocument()
    })
  })
})
