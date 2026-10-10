/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { getTimeline } from '@/lib/client'
import { Timeline } from '@/lib/services/timelines/types'
import { Attachment } from '@/lib/types/domain/attachment'

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

  beforeEach(() => {
    vi.mocked(getTimeline).mockReset()
    resetIntersectionObserver()
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
        scrollToMock.mockClear()
        window.scrollTo = scrollToMock
      })

      afterEach(() => {
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
            limit: 5
          })
        )

        const banner = screen.getByRole('button', { name: '2 new posts ↑' })
        expect(banner).toBeInTheDocument()
        expect(banner).toHaveAttribute('data-variant', 'pill')
      })

      it('clicking the banner refreshes the top snapshot and scrolls to top', async () => {
        const { post1, newPostA, newPostB } =
          await renderWithTwoNewPostsDetected()

        const banner = screen.getByRole('button', { name: '2 new posts ↑' })

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
    })

    it('renders singular "1 new post ↑" when polling detects a single new post', async () => {
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

        const banner = screen.getByRole('button', { name: '1 new post ↑' })
        expect(banner).toBeInTheDocument()
        expect(banner).toHaveAttribute('data-variant', 'pill')
      } finally {
        vi.useRealTimers()
      }
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
