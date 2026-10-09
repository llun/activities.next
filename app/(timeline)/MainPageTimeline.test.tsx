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

import { getTimeline } from '@/lib/client'
import { Timeline } from '@/lib/services/timelines/types'

import { MainPageTimeline } from './MainPageTimeline'
import {
  FIXED_CURRENT_TIME,
  createAnnounceStatus,
  createStatus,
  installIntersectionObserver,
  profile,
  resetIntersectionObserver
} from './MainPageTimeline.testUtils'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn()
  })
}))

vi.mock('@/lib/client', () => ({
  getTimeline: vi.fn()
}))

vi.mock('@/lib/components/announcements/useAnnouncements', () => ({
  useAnnouncements: () => ({ mode: 'pill' })
}))

vi.mock('@/lib/components/announcements/AnnouncementBanner', async () => {
  const utils = await import('./MainPageTimeline.testUtils')
  return {
    AnnouncementPill: utils.MockAnnouncementPill,
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

vi.mock('@/lib/components/posts/timeline-feed', async () => ({
  TimelineFeed: (await import('./MainPageTimeline.testUtils')).MockFeed
}))

vi.mock('@/lib/components/ui/button', async () => ({
  Button: (await import('./MainPageTimeline.testUtils')).MockButton
}))

describe('MainPageTimeline', () => {
  beforeAll(() => {
    installIntersectionObserver()
  })

  beforeEach(() => {
    vi.mocked(getTimeline).mockReset()
    resetIntersectionObserver()
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

  // Announcements never add a node to the header's layout: the pill floats in
  // the bottom slot and the icon is a header action beside Refresh.
  it('hands the announcement pill to the floating row and the icon to the actions', () => {
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
      within(screen.getByTestId('header-bottom-slot')).getByTestId(
        'announcement-pill'
      )
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId('header-actions')).getByTestId(
        'announcement-icon'
      )
    ).toBeInTheDocument()
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
})
