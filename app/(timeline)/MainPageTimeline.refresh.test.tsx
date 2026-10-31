/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'

import { type GetTimelineResult, getTimeline } from '@/lib/client'
import { clearAllOfflineData } from '@/lib/client/offline'
import { Timeline } from '@/lib/services/timelines/types'
import { createDeferred } from '@/lib/testing/deferred'
import { Attachment } from '@/lib/types/domain/attachment'

import { MainPageTimeline, POLL_PAGE_LIMIT } from './MainPageTimeline'
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
  simulateServerRecovered,
  simulateServerUnreachable
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

vi.mock('@/lib/client/health', () => ({ checkServerHealth: vi.fn() }))

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

  beforeEach(async () => {
    await clearAllOfflineData()
    vi.mocked(getTimeline).mockReset()
    resetIntersectionObserver()
  })

  afterEach(() => {
    resetConnectionSimulation()
  })

  describe('metadata reconciliation from updated statuses prop', () => {
    const createAttachment = (
      id: string,
      overrides: Partial<Attachment> = {}
    ): Attachment => ({
      id,
      actorId: profile.id,
      statusId: 'https://activities.local/users/llun/s/1',
      type: 'Document',
      mediaType: 'video/mp4',
      url: `https://activities.local/media/${id}.mp4`,
      name: 'Test media',
      createdAt: FIXED_CURRENT_TIME,
      updatedAt: FIXED_CURRENT_TIME,
      ...overrides
    })

    it('reconciles playbackType: gifv when statuses prop updates after navigation', () => {
      const att = createAttachment('att-1', { playbackType: undefined })
      const post1 = createStatus('https://activities.local/users/llun/s/1', {
        attachments: [att]
      })

      const { rerender } = render(
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
          'post-playback-https://activities.local/users/llun/s/1'
        )
      ).toHaveTextContent('none')

      // Simulate prop update (e.g. from page navigation back with enriched classifications)
      const enrichedAtt = createAttachment('att-1', {
        playbackType: 'gifv',
        thumbnailUrl: 'https://activities.local/media/att-1-thumb.jpg'
      })
      const enrichedPost1 = createStatus(
        'https://activities.local/users/llun/s/1',
        {
          attachments: [enrichedAtt]
        }
      )

      rerender(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[enrichedPost1]}
        />
      )

      expect(
        screen.getByTestId(
          'post-playback-https://activities.local/users/llun/s/1'
        )
      ).toHaveTextContent('gifv')
    })

    it('preserves appended pages when statuses prop updates', async () => {
      const att = createAttachment('att-1', { playbackType: undefined })
      const post1 = createStatus('https://activities.local/users/llun/s/1', {
        attachments: [att]
      })
      const post2 = createStatus('https://activities.local/users/llun/s/2')

      vi.mocked(getTimeline).mockResolvedValueOnce({
        statuses: [post2],
        nextMaxStatusId: null,
        prevMinStatusId: null
      })

      const { rerender } = render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[post1]}
          initialNextMaxStatusId="cursor-page-1"
        />
      )

      // Load page 2
      fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
      await waitFor(() => {
        expect(
          screen.getByTestId('post-https://activities.local/users/llun/s/2')
        ).toBeInTheDocument()
      })

      // Simulate prop update for page 1 statuses
      const enrichedAtt = createAttachment('att-1', { playbackType: 'gifv' })
      const enrichedPost1 = createStatus(
        'https://activities.local/users/llun/s/1',
        {
          attachments: [enrichedAtt]
        }
      )

      rerender(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[enrichedPost1]}
          initialNextMaxStatusId="cursor-page-1"
        />
      )

      // Both post1 (with gifv) and post2 (appended page) must remain present
      expect(
        screen.getByTestId(
          'post-playback-https://activities.local/users/llun/s/1'
        )
      ).toHaveTextContent('gifv')
      expect(
        screen.getByTestId('post-https://activities.local/users/llun/s/2')
      ).toBeInTheDocument()
    })

    describe('when the user has interacted with a post and the statuses prop updates', () => {
      const postUrl = 'https://activities.local/users/llun/s/1'

      const renderInteractedPost = () => {
        const att = createAttachment('att-1', { playbackType: undefined })
        const post1 = createStatus(postUrl, { attachments: [att] })

        const view = render(
          <MainPageTimeline
            host="activities.local"
            currentTime={FIXED_CURRENT_TIME}
            profile={profile}
            isMediaUploadEnabled={false}
            statuses={[post1]}
          />
        )

        // User interacts with post1: like, bookmark, react
        fireEvent.click(screen.getByTestId(`trigger-like-${postUrl}`))
        fireEvent.click(screen.getByTestId(`trigger-bookmark-${postUrl}`))
        fireEvent.click(screen.getByTestId(`trigger-react-${postUrl}`))

        return view
      }

      // Server prop updates with clean un-liked status, but with enriched playbackType
      const rerenderWithServerPost = (
        rerender: ReturnType<typeof render>['rerender']
      ) => {
        const enrichedAtt = createAttachment('att-1', { playbackType: 'gifv' })
        const serverPost1 = createStatus(postUrl, {
          attachments: [enrichedAtt],
          isActorLiked: false,
          isActorBookmarked: false,
          reactions: []
        })

        rerender(
          <MainPageTimeline
            host="activities.local"
            currentTime={FIXED_CURRENT_TIME}
            profile={profile}
            isMediaUploadEnabled={false}
            statuses={[serverPost1]}
          />
        )
      }

      it('keeps like/bookmark/reaction state when statuses prop updates', () => {
        const { rerender } = renderInteractedPost()

        expect(screen.getByTestId(`post-liked-${postUrl}`)).toHaveTextContent(
          'true'
        )
        expect(
          screen.getByTestId(`post-bookmarked-${postUrl}`)
        ).toHaveTextContent('true')
        expect(
          screen.getByTestId(`post-reactions-${postUrl}`)
        ).toHaveTextContent('1')

        rerenderWithServerPost(rerender)

        // Local interaction state is preserved
        expect(screen.getByTestId(`post-liked-${postUrl}`)).toHaveTextContent(
          'true'
        )
        expect(
          screen.getByTestId(`post-bookmarked-${postUrl}`)
        ).toHaveTextContent('true')
        expect(
          screen.getByTestId(`post-reactions-${postUrl}`)
        ).toHaveTextContent('1')
      })

      it('applies enriched playbackType from the new prop while keeping local state', () => {
        const { rerender } = renderInteractedPost()

        rerenderWithServerPost(rerender)

        expect(screen.getByTestId(`post-liked-${postUrl}`)).toHaveTextContent(
          'true'
        )
        expect(
          screen.getByTestId(`post-playback-${postUrl}`)
        ).toHaveTextContent('gifv')
      })
    })

    it('reconciles playbackType inside an Announce wrapper when original is enriched in props', () => {
      const att = createAttachment('att-orig', { playbackType: undefined })
      const orig = createStatus('https://activities.local/users/other/s/1', {
        attachments: [att]
      })
      const announce = createAnnounceStatus(
        'https://activities.local/users/llun/s/ann-1',
        orig
      )

      const { rerender } = render(
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
          'post-playback-https://activities.local/users/llun/s/ann-1'
        )
      ).toHaveTextContent('none')

      const enrichedAtt = createAttachment('att-orig', {
        playbackType: 'gifv'
      })
      const enrichedOrig = createStatus(
        'https://activities.local/users/other/s/1',
        {
          attachments: [enrichedAtt]
        }
      )
      const enrichedAnnounce = createAnnounceStatus(
        'https://activities.local/users/llun/s/ann-1',
        enrichedOrig
      )

      rerender(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[enrichedAnnounce]}
        />
      )

      expect(
        screen.getByTestId(
          'post-playback-https://activities.local/users/llun/s/ann-1'
        )
      ).toHaveTextContent('gifv')
    })
  })

  describe('reply creation', () => {
    it('increments target status totalReplies, places reply directly next to replied status in feed, and renders ReplyToast when onReplyCreated triggers', () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1', {
        totalReplies: 2
      })
      const post2 = createStatus('https://activities.local/users/llun/s/2', {
        totalReplies: 0
      })

      render(
        <MainPageTimeline
          host="activities.local"
          profile={profile}
          currentTime={1000}
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
      expect(
        screen.getByTestId(
          'post-replies-https://activities.local/users/llun/s/1'
        )
      ).toHaveTextContent('2')

      // Trigger onReplyCreated via trigger-reply-created
      fireEvent.click(screen.getByTestId('trigger-reply-created'))

      // 1. Target status's totalReplies increments
      expect(
        screen.getByTestId(
          'post-replies-https://activities.local/users/llun/s/1'
        )
      ).toHaveTextContent('3')

      // 2. The reply is inserted immediately following post1 in currentStatuses
      expect(
        screen.getByTestId(
          'post-https://activities.local/users/other/statuses/new-reply-1'
        )
      ).toBeInTheDocument()

      const renderedPostIds = screen
        .getAllByTestId(/^post-id-/)
        .map((el) => el.textContent)
      expect(renderedPostIds).toEqual([
        post1.id,
        'https://activities.local/users/other/statuses/new-reply-1',
        post2.id
      ])

      // 3. ReplyToast renders with the reply status
      expect(screen.getByRole('status')).toBeInTheDocument()
      expect(screen.getByText('Reply posted')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'View reply' })
      ).toBeInTheDocument()
    })
  })

  describe('load more paging', () => {
    it('shows retry button when fetch fails and re-triggers fetch on click', async () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      const post2 = createStatus('https://activities.local/users/llun/s/2')

      vi.mocked(getTimeline).mockRejectedValueOnce(new Error('Network error'))

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

      fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
      })
      expect(screen.getByText('Failed to load posts')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()

      vi.mocked(getTimeline).mockResolvedValueOnce({
        statuses: [post2],
        nextMaxStatusId: null,
        prevMinStatusId: null
      })

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

      await waitFor(() => {
        expect(
          screen.getByTestId('post-https://activities.local/users/llun/s/2')
        ).toBeInTheDocument()
      })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('preserves server cursor when received page contains duplicate items', async () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      const post2 = createStatus('https://activities.local/users/llun/s/2')
      const post3 = createStatus('https://activities.local/users/llun/s/3')

      // First fetch-more returns duplicate items with updated server cursor
      vi.mocked(getTimeline).mockResolvedValueOnce({
        statuses: [post1, post2],
        nextMaxStatusId: 'cursor-page-2',
        prevMinStatusId: null
      })

      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[post1, post2]}
          initialNextMaxStatusId="cursor-page-1"
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

      await waitFor(() => {
        expect(getTimeline).toHaveBeenCalledWith({
          timeline: Timeline.MAIN,
          maxStatusId: 'cursor-page-1'
        })
      })

      // No duplicate rows added
      const renderedPostIds = screen
        .getAllByTestId(/^post-id-/)
        .map((el) => el.textContent)
      expect(renderedPostIds).toEqual([post1.id, post2.id])

      // hasMore is preserved because nextMaxStatusId is valid
      expect(
        screen.getByRole('button', { name: 'Load more' })
      ).toBeInTheDocument()

      // Subsequent fetch-more advances past the duplicate page using updated cursor
      vi.mocked(getTimeline).mockResolvedValueOnce({
        statuses: [post3],
        nextMaxStatusId: null,
        prevMinStatusId: null
      })

      fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

      await waitFor(() => {
        expect(getTimeline).toHaveBeenCalledWith({
          timeline: Timeline.MAIN,
          maxStatusId: 'cursor-page-2'
        })
      })

      await waitFor(() => {
        expect(
          screen.getByTestId('post-https://activities.local/users/llun/s/3')
        ).toBeInTheDocument()
      })
    })
  })

  describe('new post polling', () => {
    describe('polling banner', () => {
      const scrollToMock = vi.fn()
      let originalScrollTo: typeof window.scrollTo

      beforeEach(() => {
        vi.useFakeTimers()
        originalScrollTo = window.scrollTo
        scrollToMock.mockReset()
        window.scrollTo = scrollToMock
      })

      afterEach(() => {
        cleanup()
        window.scrollTo = originalScrollTo
        vi.useRealTimers()
      })

      const renderWithTwoNewPostsDetected = async () => {
        const post1 = createStatus('https://activities.local/users/llun/s/1')
        const newPostA = createStatus(
          'https://activities.local/users/llun/s/new-a'
        )
        const newPostB = createStatus(
          'https://activities.local/users/llun/s/new-b'
        )

        render(
          <MainPageTimeline
            host="activities.local"
            currentTime={FIXED_CURRENT_TIME}
            profile={profile}
            isMediaUploadEnabled={false}
            statuses={[post1]}
          />
        )

        // Mock background poll detecting 2 new posts
        vi.mocked(getTimeline).mockResolvedValueOnce({
          statuses: [newPostA, newPostB],
          nextMaxStatusId: null,
          prevMinStatusId: 'https://activities.local/users/llun/s/new-a'
        })

        await act(async () => {
          vi.advanceTimersByTime(15000)
          await Promise.resolve()
          await Promise.resolve()
        })

        return { post1, newPostA, newPostB }
      }

      it('displays the polling banner when newer posts are detected', async () => {
        await renderWithTwoNewPostsDetected()

        expect(getTimeline).toHaveBeenCalledWith(
          expect.objectContaining({
            timeline: Timeline.MAIN,
            limit: POLL_PAGE_LIMIT
          })
        )

        const banner = screen.getByRole('button', { name: '2 new posts' })
        expect(banner).toBeInTheDocument()
        expect(banner).toHaveAttribute('data-variant', 'pill')
      })

      it('clicking the banner refreshes the top snapshot and scrolls to top', async () => {
        const { post1, newPostA, newPostB } =
          await renderWithTwoNewPostsDetected()

        const banner = screen.getByRole('button', { name: '2 new posts' })

        // Mock clean top snapshot fetch
        vi.mocked(getTimeline).mockResolvedValueOnce({
          statuses: [newPostA, newPostB, post1],
          nextMaxStatusId: 'cursor-after-top',
          prevMinStatusId: null
        })

        await act(async () => {
          fireEvent.click(banner)
          await Promise.resolve()
          await Promise.resolve()
        })

        expect(scrollToMock).toHaveBeenCalledWith({
          top: 0,
          behavior: 'smooth'
        })
        expect(getTimeline).toHaveBeenCalledWith({
          timeline: Timeline.MAIN
        })
        expect(
          screen.queryByRole('button', { name: /new post/ })
        ).not.toBeInTheDocument()
        expect(
          screen.getByTestId('post-https://activities.local/users/llun/s/new-a')
        ).toBeInTheDocument()
      })

      it('tap the pill with fetch pending, reader scrolls down, response lands: window.scrollTo is not called with instant top 0', async () => {
        const originalScrollY = window.scrollY
        try {
          const { post1, newPostA, newPostB } =
            await renderWithTwoNewPostsDetected()

          const banner = screen.getByRole('button', { name: '2 new posts' })

          const deferred = createDeferred<GetTimelineResult>()
          vi.mocked(getTimeline).mockReturnValueOnce(deferred.promise)

          await act(async () => {
            fireEvent.click(banner)
            await Promise.resolve()
          })

          // scrollPageToTop called smooth scroll to top 0
          expect(scrollToMock).toHaveBeenCalledWith({
            top: 0,
            behavior: 'smooth'
          })
          scrollToMock.mockClear()

          // Reader scrolls down while the refresh fetch is still in flight
          Object.defineProperty(window, 'scrollY', {
            value: 300,
            configurable: true,
            writable: true
          })
          await act(async () => {
            fireEvent.scroll(window)
            await Promise.resolve()
          })

          // Response lands
          await act(async () => {
            deferred.resolve({
              statuses: [newPostA, newPostB, post1],
              nextMaxStatusId: 'cursor-after-top',
              prevMinStatusId: null
            })
            await Promise.resolve()
            await Promise.resolve()
          })

          // window.scrollTo is NOT called with instant top 0
          expect(scrollToMock).not.toHaveBeenCalledWith({
            top: 0,
            behavior: 'instant'
          })
        } finally {
          Object.defineProperty(window, 'scrollY', {
            value: originalScrollY,
            configurable: true,
            writable: true
          })
        }
      })
    })

    it('renders singular "1 new post" when polling detects a single new post', async () => {
      vi.useFakeTimers()
      try {
        const post1 = createStatus('https://activities.local/users/llun/s/1')
        const newPostA = createStatus(
          'https://activities.local/users/llun/s/new-a'
        )

        render(
          <MainPageTimeline
            host="activities.local"
            currentTime={FIXED_CURRENT_TIME}
            profile={profile}
            isMediaUploadEnabled={false}
            statuses={[post1]}
          />
        )

        vi.mocked(getTimeline).mockResolvedValueOnce({
          statuses: [newPostA],
          nextMaxStatusId: null,
          prevMinStatusId: 'https://activities.local/users/llun/s/new-a'
        })

        await act(async () => {
          vi.advanceTimersByTime(15000)
          await Promise.resolve()
          await Promise.resolve()
        })

        const banner = screen.getByRole('button', { name: '1 new post' })
        expect(banner).toBeInTheDocument()
        expect(banner).toHaveAttribute('data-variant', 'pill')
      } finally {
        vi.useRealTimers()
      }
    })

    it('shows the pill when a poll at the top detects new posts', async () => {
      vi.useFakeTimers()
      try {
        const post1 = createStatus('https://activities.local/users/llun/s/1')
        const newPostA = createStatus(
          'https://activities.local/users/llun/s/new-a'
        )
        const newPostB = createStatus(
          'https://activities.local/users/llun/s/new-b'
        )

        render(
          <MainPageTimeline
            host="activities.local"
            currentTime={FIXED_CURRENT_TIME}
            profile={profile}
            isMediaUploadEnabled={false}
            statuses={[post1]}
          />
        )

        vi.mocked(getTimeline).mockResolvedValueOnce({
          statuses: [newPostA, newPostB],
          nextMaxStatusId: null,
          prevMinStatusId: newPostA.id
        })

        await act(async () => {
          vi.advanceTimersByTime(15000)
          await Promise.resolve()
          await Promise.resolve()
        })

        expect(
          screen.getByRole('button', { name: '2 new posts' })
        ).toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })

    it('removes the pill when a subsequent poll returns no statuses', async () => {
      vi.useFakeTimers()
      try {
        const post1 = createStatus('https://activities.local/users/llun/s/1')
        const newPostA = createStatus(
          'https://activities.local/users/llun/s/new-a'
        )
        const newPostB = createStatus(
          'https://activities.local/users/llun/s/new-b'
        )

        render(
          <MainPageTimeline
            host="activities.local"
            currentTime={FIXED_CURRENT_TIME}
            profile={profile}
            isMediaUploadEnabled={false}
            statuses={[post1]}
          />
        )

        vi.mocked(getTimeline).mockResolvedValueOnce({
          statuses: [newPostA, newPostB],
          nextMaxStatusId: null,
          prevMinStatusId: newPostA.id
        })

        await act(async () => {
          vi.advanceTimersByTime(15000)
          await Promise.resolve()
          await Promise.resolve()
        })

        expect(
          screen.getByRole('button', { name: '2 new posts' })
        ).toBeInTheDocument()

        vi.mocked(getTimeline).mockResolvedValueOnce({
          statuses: [],
          nextMaxStatusId: null,
          prevMinStatusId: null
        })

        await act(async () => {
          vi.advanceTimersByTime(15000)
          await Promise.resolve()
          await Promise.resolve()
        })

        expect(
          screen.queryByRole('button', { name: /new post/i })
        ).not.toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })

    it('renders "20+ new posts" when poll returns POLL_PAGE_LIMIT posts while scrolled down', async () => {
      vi.useFakeTimers()
      const originalScrollY = window.scrollY
      try {
        const post1 = createStatus('https://activities.local/users/llun/s/1')
        const polledStatuses = Array.from({ length: POLL_PAGE_LIMIT }, (_, i) =>
          createStatus(`https://activities.local/users/llun/s/poll-${i}`)
        )

        render(
          <MainPageTimeline
            host="activities.local"
            currentTime={FIXED_CURRENT_TIME}
            profile={profile}
            isMediaUploadEnabled={false}
            statuses={[post1]}
          />
        )

        Object.defineProperty(window, 'scrollY', {
          value: 200,
          configurable: true,
          writable: true
        })
        fireEvent.scroll(window)

        vi.mocked(getTimeline).mockResolvedValueOnce({
          statuses: polledStatuses,
          nextMaxStatusId: null,
          prevMinStatusId: polledStatuses[0].id
        })

        await act(async () => {
          vi.advanceTimersByTime(15000)
          await Promise.resolve()
          await Promise.resolve()
        })

        expect(
          screen.getByRole('button', { name: '20+ new posts' })
        ).toBeInTheDocument()
      } finally {
        Object.defineProperty(window, 'scrollY', {
          value: originalScrollY,
          configurable: true,
          writable: true
        })
        vi.useRealTimers()
      }
    })
  })

  describe('posts loaded above the reading spot', () => {
    const scrollToMock = vi.fn()
    const scrollByMock = vi.fn()
    let originalScrollTo: typeof window.scrollTo
    let originalScrollBy: typeof window.scrollBy
    let originalScrollY: number
    let originalRect: typeof HTMLElement.prototype.getBoundingClientRect
    let originalRaf: typeof window.requestAnimationFrame
    // Where each feed row sits on screen, by status id: a row whose bottom is
    // above the sticky header (80px) has scrolled out of view upwards.
    let rowTops: Record<string, number>

    beforeEach(() => {
      originalScrollTo = window.scrollTo
      originalScrollBy = window.scrollBy
      originalScrollY = window.scrollY
      scrollToMock.mockReset()
      scrollByMock.mockReset()
      window.scrollTo = scrollToMock
      window.scrollBy = scrollByMock
      originalRect = HTMLElement.prototype.getBoundingClientRect
      rowTops = {}
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
      originalRaf = window.requestAnimationFrame
      window.requestAnimationFrame = (callback: FrameRequestCallback) => {
        queueMicrotask(() => callback(0))
        return 1
      }
    })

    afterEach(() => {
      cleanup()
      window.scrollTo = originalScrollTo
      window.scrollBy = originalScrollBy
      HTMLElement.prototype.getBoundingClientRect = originalRect
      window.requestAnimationFrame = originalRaf
      Object.defineProperty(window, 'scrollY', {
        value: originalScrollY,
        configurable: true,
        writable: true
      })
    })

    it('counts posts a refresh loads above the reader, down to none as they scroll into view', async () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      const post2 = createStatus('https://activities.local/users/llun/s/2')
      const newA = createStatus('https://activities.local/users/llun/s/new-a')
      const newB = createStatus('https://activities.local/users/llun/s/new-b')
      rowTops = { [post1.id]: -400, [post2.id]: 120 }

      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[post1, post2]}
        />
      )

      // Coming back online refreshes in place, keeping the reading spot.
      vi.mocked(getTimeline).mockResolvedValueOnce({
        statuses: [newA, newB, post1, post2],
        nextMaxStatusId: null,
        prevMinStatusId: newA.id
      })
      rowTops = {
        [newA.id]: -900,
        [newB.id]: -650,
        [post1.id]: -400,
        [post2.id]: 120
      }
      await simulateOffline()
      await simulateBackOnline()

      expect(
        await screen.findByRole('button', { name: '2 new posts' })
      ).toBeInTheDocument()

      // Reading upwards: the newer of the two is still above.
      rowTops = {
        [newA.id]: -250,
        [newB.id]: 0,
        [post1.id]: 250,
        [post2.id]: 770
      }
      await act(async () => {
        window.dispatchEvent(new Event('scroll'))
        await Promise.resolve()
      })
      expect(
        screen.getByRole('button', { name: '1 new post' })
      ).toBeInTheDocument()

      rowTops = {
        [newA.id]: 100,
        [newB.id]: 350,
        [post1.id]: 600,
        [post2.id]: 1120
      }
      await act(async () => {
        window.dispatchEvent(new Event('scroll'))
        await Promise.resolve()
      })
      expect(
        screen.queryByRole('button', { name: /new post/ })
      ).not.toBeInTheDocument()
    })

    it('does not count posts again when the pill reloads and jumps to the top', async () => {
      vi.useFakeTimers()
      try {
        const post1 = createStatus('https://activities.local/users/llun/s/1')
        const newA = createStatus('https://activities.local/users/llun/s/new-a')
        rowTops = { [post1.id]: 120 }

        render(
          <MainPageTimeline
            host="activities.local"
            currentTime={FIXED_CURRENT_TIME}
            profile={profile}
            isMediaUploadEnabled={false}
            statuses={[post1]}
          />
        )

        vi.mocked(getTimeline).mockResolvedValueOnce({
          statuses: [newA],
          nextMaxStatusId: null,
          prevMinStatusId: newA.id
        })
        await act(async () => {
          vi.advanceTimersByTime(15000)
          await Promise.resolve()
          await Promise.resolve()
        })
        const pill = screen.getByRole('button', { name: '1 new post' })

        // The reload lands while the smooth scroll is still on its way up,
        // with the new post above the screen.
        vi.mocked(getTimeline).mockResolvedValueOnce({
          statuses: [newA, post1],
          nextMaxStatusId: null,
          prevMinStatusId: newA.id
        })
        rowTops = { [newA.id]: -300, [post1.id]: 120 }
        await act(async () => {
          fireEvent.click(pill)
          await Promise.resolve()
          await Promise.resolve()
        })

        expect(screen.getByTestId(`post-${newA.id}`)).toBeInTheDocument()
        expect(
          screen.queryByRole('button', { name: /new post/ })
        ).not.toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })

    it('jumps to the newest post without reloading when every new post is loaded', async () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      const newA = createStatus('https://activities.local/users/llun/s/new-a')
      rowTops = { [post1.id]: 20 }

      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[post1]}
        />
      )

      vi.mocked(getTimeline).mockImplementationOnce(async () => {
        rowTops = { [newA.id]: -300, [post1.id]: 20 }
        return {
          statuses: [newA, post1],
          nextMaxStatusId: null,
          prevMinStatusId: newA.id
        }
      })
      await simulateOffline()
      await simulateBackOnline()

      const pill = await screen.findByRole('button', { name: '1 new post' })
      vi.mocked(getTimeline).mockClear()
      await act(async () => {
        fireEvent.click(pill)
      })

      expect(scrollToMock).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
      expect(getTimeline).not.toHaveBeenCalled()
      expect(
        screen.queryByRole('button', { name: /new post/ })
      ).not.toBeInTheDocument()
    })

    it('clamps capturedAnchor offsetTop to VIEW_TOP_EDGE (80px) when new posts are prepended above a mid-feed reading spot', async () => {
      const post0 = createStatus('https://activities.local/users/llun/s/0')
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      const newA = createStatus('https://activities.local/users/llun/s/new-a')
      // post0 has scrolled above the sticky header (bottom = -50 <= 80) and
      // post1 starts at 120px (e.g. below a gap/divider after post0).
      rowTops = { [post0.id]: -150, [post1.id]: 120 }

      // Simulate window.scrollBy shifting all rows' viewport top by -diff.
      scrollByMock.mockImplementation((opts?: ScrollToOptions | number) => {
        const delta =
          typeof opts === 'object' && opts !== null ? (opts.top ?? 0) : 0
        for (const key of Object.keys(rowTops)) {
          rowTops[key] -= delta
        }
      })

      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[post0, post1]}
        />
      )

      vi.mocked(getTimeline).mockImplementationOnce(async () => {
        // When newA (250px tall) is prepended above post0 before scroll adjustment:
        const shiftedTops = {
          [newA.id]: -150,
          [post0.id]: 100,
          [post1.id]: 370
        }
        const prevGetBoundingClientRect =
          HTMLElement.prototype.getBoundingClientRect
        HTMLElement.prototype.getBoundingClientRect = function () {
          const id = this.getAttribute('data-status-id')
          if (
            id === newA.id ||
            document.querySelector(`[data-status-id="${newA.id}"]`)
          ) {
            const top = id && id in shiftedTops ? shiftedTops[id] : 0
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
          return prevGetBoundingClientRect.call(this)
        }
        return {
          statuses: [newA, post0, post1],
          nextMaxStatusId: null,
          prevMinStatusId: newA.id
        }
      })

      await simulateOffline()
      await simulateBackOnline()

      // Because capturedAnchor.offsetTop (120px) was clamped to 80px, scrollBy
      // shifts by 370 - 80 = 290px, placing post1 at 80px, post0 at -190px,
      // and newA at -440px (bottom -340 <= 80).
      expect(scrollByMock).toHaveBeenCalledWith({
        top: 290,
        behavior: 'instant'
      })
      expect(
        await screen.findByRole('button', { name: '1 new post' })
      ).toBeInTheDocument()
    })

    it('does not scroll down when preserveScroll refresh at the top of the timeline returns 0 new posts', async () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      rowTops = { [post1.id]: 310 }

      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[post1]}
        />
      )

      vi.mocked(getTimeline).mockResolvedValueOnce({
        statuses: [post1],
        nextMaxStatusId: null,
        prevMinStatusId: post1.id
      })

      await simulateOffline()
      await simulateBackOnline()

      expect(scrollByMock).not.toHaveBeenCalled()
      expect(
        screen.queryByRole('button', { name: /new post|Back to top/ })
      ).not.toBeInTheDocument()
    })

    it('does not scroll down or show unseen pill when preserveScroll refresh at the top of the timeline prepends new posts', async () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      const newA = createStatus('https://activities.local/users/llun/s/new-a')
      rowTops = { [post1.id]: 310 }

      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[post1]}
        />
      )

      vi.mocked(getTimeline).mockResolvedValueOnce({
        statuses: [newA, post1],
        nextMaxStatusId: null,
        prevMinStatusId: newA.id
      })
      rowTops = { [newA.id]: 310, [post1.id]: 560 }

      await simulateOffline()
      await simulateBackOnline()

      expect(screen.getByTestId(`post-${newA.id}`)).toBeInTheDocument()
      expect(scrollByMock).not.toHaveBeenCalled()
      expect(
        screen.queryByRole('button', { name: /new post|Back to top/ })
      ).not.toBeInTheDocument()
    })

    it('does not scroll to top 0 and counts new posts in pill when reader scrolls past 80px during pending mount refresh with no saved anchor', async () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      const post2 = createStatus('https://activities.local/users/llun/s/2')
      const newPost = createStatus('https://activities.local/users/llun/s/new')

      const deferred = createDeferred<GetTimelineResult>()
      vi.mocked(getTimeline).mockReturnValueOnce(deferred.promise)

      rowTops = { [post1.id]: 20, [post2.id]: 150 }

      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[post1, post2]}
          refreshOnMount={true}
        />
      )

      expect(getTimeline).toHaveBeenCalledTimes(1)

      try {
        Object.defineProperty(window, 'scrollY', {
          value: 120,
          configurable: true,
          writable: true
        })
        rowTops = { [post1.id]: -100, [post2.id]: 30 }
        await act(async () => {
          window.dispatchEvent(new Event('scroll'))
          await Promise.resolve()
        })

        rowTops = { [newPost.id]: -250, [post1.id]: -100, [post2.id]: 30 }

        await act(async () => {
          deferred.resolve({
            statuses: [newPost, post1, post2],
            nextMaxStatusId: null,
            prevMinStatusId: newPost.id
          })
          await Promise.resolve()
        })

        expect(scrollToMock).not.toHaveBeenCalledWith(
          expect.objectContaining({ top: 0 })
        )

        expect(
          await screen.findByRole('button', { name: '1 new post' })
        ).toBeInTheDocument()
      } finally {
        Object.defineProperty(window, 'scrollY', {
          value: originalScrollY,
          configurable: true,
          writable: true
        })
      }
    })

    it('lands posts directly with no pill when reader stays at top during mount refresh with no saved anchor', async () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      const newPost = createStatus('https://activities.local/users/llun/s/new')

      const deferred = createDeferred<GetTimelineResult>()
      vi.mocked(getTimeline).mockReturnValueOnce(deferred.promise)

      rowTops = { [post1.id]: 20 }

      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[post1]}
          refreshOnMount={true}
        />
      )

      expect(getTimeline).toHaveBeenCalledTimes(1)

      await act(async () => {
        deferred.resolve({
          statuses: [newPost, post1],
          nextMaxStatusId: null,
          prevMinStatusId: newPost.id
        })
        await Promise.resolve()
      })

      expect(
        await screen.findByTestId(`post-${newPost.id}`)
      ).toBeInTheDocument()

      expect(
        screen.queryByRole('button', { name: /new post|Back to top/ })
      ).not.toBeInTheDocument()
    })

    it('uses the post on screen at response time for scroll correction when reader scrolls to a different post during preserveScroll refresh', async () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      const post2 = createStatus('https://activities.local/users/llun/s/2')
      const post3 = createStatus('https://activities.local/users/llun/s/3')
      const newPost = createStatus('https://activities.local/users/llun/s/new')

      rowTops = { [post1.id]: -200, [post2.id]: 100, [post3.id]: 350 }

      const deferred = createDeferred<GetTimelineResult>()
      vi.mocked(getTimeline).mockReturnValueOnce(deferred.promise)

      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[post1, post2, post3]}
        />
      )

      await simulateOffline()
      await simulateBackOnline()
      expect(getTimeline).toHaveBeenCalledTimes(1)

      // Reader scrolls to post3 while fetch is pending
      rowTops = { [post1.id]: -450, [post2.id]: -150, [post3.id]: 100 }
      await act(async () => {
        window.dispatchEvent(new Event('scroll'))
        await Promise.resolve()
      })

      const shiftedTops = {
        [newPost.id]: -150,
        [post1.id]: -200,
        [post2.id]: 100,
        [post3.id]: 350
      }
      const prevGetBoundingClientRect =
        HTMLElement.prototype.getBoundingClientRect
      HTMLElement.prototype.getBoundingClientRect = function () {
        const id = this.getAttribute('data-status-id')
        if (
          id === newPost.id ||
          document.querySelector(`[data-status-id="${newPost.id}"]`)
        ) {
          const top = id && id in shiftedTops ? shiftedTops[id] : 0
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
        return prevGetBoundingClientRect.call(this)
      }

      await act(async () => {
        deferred.resolve({
          statuses: [newPost, post1, post2, post3],
          nextMaxStatusId: null,
          prevMinStatusId: newPost.id
        })
        await Promise.resolve()
      })

      expect(scrollByMock).toHaveBeenCalledWith({
        top: 270,
        behavior: 'instant'
      })
    })
  })

  describe('connection store', () => {
    const renderHome = () => {
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
      return post1
    }

    afterEach(() => {
      cleanup()
      vi.useRealTimers()
    })

    it('refreshes in place when the server answers again, even without a browser online event', async () => {
      const post1 = renderHome()
      vi.mocked(getTimeline).mockResolvedValue({
        statuses: [post1],
        nextMaxStatusId: null,
        prevMinStatusId: post1.id
      })
      await simulateServerUnreachable()
      expect(getTimeline).not.toHaveBeenCalled()

      await simulateServerRecovered()

      expect(getTimeline).toHaveBeenCalledTimes(1)
    })

    it('does not refresh while the connection is merely hinted offline and the probe has not recovered', async () => {
      renderHome()

      await simulateOffline()
      await simulateServerUnreachable()

      expect(getTimeline).not.toHaveBeenCalled()
    })

    it('polls for newer posts while online and skips the poll while not online', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
      const post1 = renderHome()
      vi.mocked(getTimeline).mockResolvedValue({
        statuses: [],
        nextMaxStatusId: null,
        prevMinStatusId: post1.id
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000)
      })
      expect(getTimeline).toHaveBeenCalledTimes(1)
      expect(getTimeline).toHaveBeenLastCalledWith(
        expect.objectContaining({ minStatusId: post1.id })
      )

      await simulateServerUnreachable()
      vi.mocked(getTimeline).mockClear()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
      })

      expect(getTimeline).not.toHaveBeenCalled()
    })
  })

  describe('empty feed with a cursor', () => {
    it('renders load more in-flow when visible feed is initially empty but cursor exists', () => {
      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[]}
          initialNextMaxStatusId="cursor-initial"
        />
      )

      const loadMoreBtn = screen.getByRole('button', { name: 'Load more' })
      expect(loadMoreBtn).toBeInTheDocument()
      // An empty feed has no rows to overlay, so it must not be the
      // zero-height overlay a non-empty feed uses.
      expect(loadMoreBtn.closest('div')).not.toHaveClass('max-md:h-0')
    })
  })
})
