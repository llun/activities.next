/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, within } from '@testing-library/react'

import { getHashtagTimeline } from '@/lib/client'
import { MobileNavigationProvider } from '@/lib/components/layout/mobile-navigation-context'
import { createDeferred } from '@/lib/testing/deferred'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusAnnounce, StatusType } from '@/lib/types/domain/status'

import { HashtagTimeline } from './HashtagTimeline'

vi.mock('@/lib/client', () => ({
  getHashtagTimeline: vi.fn()
}))

// Surface the showActions / showReadOnlyStats flags as data attributes so the
// tests can assert the logged-in vs logged-out engagement row without pulling
// in the real Posts tree.
vi.mock('@/lib/components/posts/posts', () => ({
  Posts: ({
    statuses,
    showActions,
    showReadOnlyStats,
    onPostDeleted,
    onPostUpdated,
    onLikeChanged,
    onBookmarkChanged,
    onReactionsChanged
  }: {
    statuses: Status[]
    showActions?: boolean
    showReadOnlyStats?: boolean
    onPostDeleted?: (status: Status) => void
    onPostUpdated?: (status: Status) => void
    onLikeChanged?: (status: any, isLiked: boolean) => void
    onBookmarkChanged?: (status: any, isBookmarked: boolean) => void
    onReactionsChanged?: (status: any, reactions: any[]) => void
  }) => (
    <div
      data-testid="posts"
      data-show-actions={String(Boolean(showActions))}
      data-read-only-stats={String(Boolean(showReadOnlyStats))}
    >
      {statuses.map((s) => {
        const target =
          s.type === StatusType.enum.Announce ? s.originalStatus : s
        return (
          <div key={s.id} data-testid={`post-${s.id}`}>
            <span data-testid={`post-id-${s.id}`}>id:{s.id}</span>
            <span data-testid={`post-text-${s.id}`}>
              {(target as any).text}
            </span>
            <span data-testid={`post-liked-${s.id}`}>
              {String((target as any).isActorLiked)}
            </span>
            <span data-testid={`post-bookmarked-${s.id}`}>
              {String((target as any).isActorBookmarked)}
            </span>
            <span data-testid={`post-likes-${s.id}`}>
              {(target as any).totalLikes ?? 0}
            </span>
            <span data-testid={`post-reactions-${s.id}`}>
              {(target as any).reactions?.length ?? 0}
            </span>
            <button
              type="button"
              data-testid={`trigger-delete-${s.id}`}
              onClick={() => onPostDeleted?.(s)}
            >
              delete
            </button>
            <button
              type="button"
              data-testid={`trigger-update-${s.id}`}
              onClick={() =>
                onPostUpdated?.({ ...target, text: 'updated text' } as any)
              }
            >
              update
            </button>
            <button
              type="button"
              data-testid={`trigger-like-${s.id}`}
              onClick={() => onLikeChanged?.(target as any, true)}
            >
              like
            </button>
            <button
              type="button"
              data-testid={`trigger-unlike-${s.id}`}
              onClick={() => onLikeChanged?.(target as any, false)}
            >
              unlike
            </button>
            <button
              type="button"
              data-testid={`trigger-bookmark-${s.id}`}
              onClick={() => onBookmarkChanged?.(target as any, true)}
            >
              bookmark
            </button>
            <button
              type="button"
              data-testid={`trigger-unbookmark-${s.id}`}
              onClick={() => onBookmarkChanged?.(target as any, false)}
            >
              unbookmark
            </button>
            <button
              type="button"
              data-testid={`trigger-react-${s.id}`}
              onClick={() =>
                onReactionsChanged?.(target as any, [
                  { name: '✨', count: 1, me: true }
                ])
              }
            >
              react
            </button>
          </div>
        )
      })}
    </div>
  )
}))

vi.mock('@/lib/components/scroll-to-top-button', () => ({
  ScrollToTopButton: () => null
}))

vi.mock('@/lib/components/posts/useLoadMoreOnVisible', () => ({
  useLoadMoreOnVisible: () => ({
    loadMoreRef: vi.fn(),
    isLoadMoreVisible: false
  })
}))

const createStatus = (
  id: string,
  overrides: Record<string, any> = {}
): Status =>
  ({
    id,
    type: StatusType.enum.Note,
    text: id,
    isActorLiked: false,
    isActorBookmarked: false,
    totalLikes: 0,
    ...overrides
  }) as unknown as Status

const createAnnounceStatus = (
  id: string,
  originalStatus: Status
): StatusAnnounce =>
  ({
    id,
    type: StatusType.enum.Announce,
    originalStatus
  }) as unknown as StatusAnnounce

const statuses = [createStatus('status-1')]

const baseProps = {
  tag: 'fediverse',
  host: 'llun.social',
  statuses,
  postCount: 1,
  currentTime: 1_700_000_000_000
}

describe('HashtagTimeline', () => {
  it.each([
    {
      description: 'shows read-only engagement stats for logged-out viewers',
      currentActor: undefined,
      showActions: 'false',
      readOnlyStats: 'true'
    },
    {
      description:
        'enables interactive actions and hides read-only stats when signed in',
      currentActor: {} as ActorProfile,
      showActions: 'true',
      readOnlyStats: 'false'
    }
  ])('$description', ({ currentActor, showActions, readOnlyStats }) => {
    render(<HashtagTimeline {...baseProps} currentActor={currentActor} />)

    const feed = screen.getByTestId('posts')
    expect(feed).toHaveAttribute('data-show-actions', showActions)
    expect(feed).toHaveAttribute('data-read-only-stats', readOnlyStats)
  })

  describe('status updates and engagement sync', () => {
    it('updates matching status in place on onPostUpdated', () => {
      const post1 = createStatus('https://activities.local/s/1')
      render(<HashtagTimeline {...baseProps} statuses={[post1]} />)

      expect(
        screen.getByTestId('post-text-https://activities.local/s/1')
      ).toHaveTextContent('https://activities.local/s/1')

      fireEvent.click(
        screen.getByTestId('trigger-update-https://activities.local/s/1')
      )

      expect(
        screen.getByTestId('post-text-https://activities.local/s/1')
      ).toHaveTextContent('updated text')
    })

    it('updates announce wrapper when original status is updated', () => {
      const original = createStatus('https://activities.local/s/original')
      const announce = createAnnounceStatus(
        'https://activities.local/s/announce-1',
        original
      )

      render(<HashtagTimeline {...baseProps} statuses={[announce]} />)

      expect(
        screen.getByTestId('post-text-https://activities.local/s/announce-1')
      ).toHaveTextContent('https://activities.local/s/original')

      fireEvent.click(
        screen.getByTestId(
          'trigger-update-https://activities.local/s/announce-1'
        )
      )

      expect(
        screen.getByTestId('post-text-https://activities.local/s/announce-1')
      ).toHaveTextContent('updated text')
    })

    it('removes matching status on onPostDeleted', () => {
      const post1 = createStatus('https://activities.local/s/1')
      render(<HashtagTimeline {...baseProps} statuses={[post1]} />)

      expect(
        screen.getByTestId('post-https://activities.local/s/1')
      ).toBeInTheDocument()

      fireEvent.click(
        screen.getByTestId('trigger-delete-https://activities.local/s/1')
      )

      expect(
        screen.queryByTestId('post-https://activities.local/s/1')
      ).not.toBeInTheDocument()
    })

    it('removes announce wrapper when original status is deleted', () => {
      const original = createStatus('https://activities.local/s/original')
      const announce = createAnnounceStatus(
        'https://activities.local/s/announce-1',
        original
      )

      render(<HashtagTimeline {...baseProps} statuses={[announce]} />)

      expect(
        screen.getByTestId('post-https://activities.local/s/announce-1')
      ).toBeInTheDocument()

      fireEvent.click(
        screen.getByTestId(
          'trigger-delete-https://activities.local/s/announce-1'
        )
      )

      expect(
        screen.queryByTestId('post-https://activities.local/s/announce-1')
      ).not.toBeInTheDocument()
    })

    it('updates like count and liked status when onLikeChanged is triggered', () => {
      const post1 = createStatus('https://activities.local/s/1')
      render(<HashtagTimeline {...baseProps} statuses={[post1]} />)

      expect(
        screen.getByTestId('post-liked-https://activities.local/s/1')
      ).toHaveTextContent('false')
      expect(
        screen.getByTestId('post-likes-https://activities.local/s/1')
      ).toHaveTextContent('0')

      fireEvent.click(
        screen.getByTestId('trigger-like-https://activities.local/s/1')
      )

      expect(
        screen.getByTestId('post-liked-https://activities.local/s/1')
      ).toHaveTextContent('true')
      expect(
        screen.getByTestId('post-likes-https://activities.local/s/1')
      ).toHaveTextContent('1')

      fireEvent.click(
        screen.getByTestId('trigger-unlike-https://activities.local/s/1')
      )

      expect(
        screen.getByTestId('post-liked-https://activities.local/s/1')
      ).toHaveTextContent('false')
      expect(
        screen.getByTestId('post-likes-https://activities.local/s/1')
      ).toHaveTextContent('0')
    })

    it('updates bookmark status when onBookmarkChanged is triggered', () => {
      const post1 = createStatus('https://activities.local/s/1')
      render(<HashtagTimeline {...baseProps} statuses={[post1]} />)

      expect(
        screen.getByTestId('post-bookmarked-https://activities.local/s/1')
      ).toHaveTextContent('false')

      fireEvent.click(
        screen.getByTestId('trigger-bookmark-https://activities.local/s/1')
      )

      expect(
        screen.getByTestId('post-bookmarked-https://activities.local/s/1')
      ).toHaveTextContent('true')

      fireEvent.click(
        screen.getByTestId('trigger-unbookmark-https://activities.local/s/1')
      )

      expect(
        screen.getByTestId('post-bookmarked-https://activities.local/s/1')
      ).toHaveTextContent('false')
    })

    it('updates reactions when onReactionsChanged is triggered', () => {
      const post1 = createStatus('https://activities.local/s/1')
      render(<HashtagTimeline {...baseProps} statuses={[post1]} />)

      expect(
        screen.getByTestId('post-reactions-https://activities.local/s/1')
      ).toHaveTextContent('0')

      fireEvent.click(
        screen.getByTestId('trigger-react-https://activities.local/s/1')
      )

      expect(
        screen.getByTestId('post-reactions-https://activities.local/s/1')
      ).toHaveTextContent('1')
    })
  })

  describe('page heading', () => {
    const renderSignedIn = (props = {}) =>
      render(
        <MobileNavigationProvider>
          <HashtagTimeline {...baseProps} {...props} />
        </MobileNavigationProvider>
      )

    it('renders the compact bar titled with the tag under MobileNavigationProvider', () => {
      const { container } = renderSignedIn()

      const bar = container.querySelector(
        '[data-mobile-compact-header]'
      ) as HTMLElement
      expect(
        within(bar).getByRole('button', { name: 'Open navigation' })
      ).toBeInTheDocument()
      expect(
        within(bar).getByRole('heading', {
          level: 1,
          name: `#${baseProps.tag}`
        })
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('link', { name: 'Activities home' })
      ).not.toBeInTheDocument()
    })

    it('uses the standard PageHeader chrome from md up when signed in', () => {
      const { container } = renderSignedIn()

      const bar = container.querySelector(
        '[data-mobile-compact-header]'
      ) as HTMLElement
      const [, boxHeading] = screen.getAllByRole('heading', {
        level: 1,
        name: `#${baseProps.tag}`
      })
      expect(bar).not.toContainElement(boxHeading)
    })

    it('keeps the phone layout: bar, then the plain count, and no box', () => {
      const { container } = renderSignedIn()

      const bar = container.querySelector(
        '[data-mobile-compact-header]'
      ) as HTMLElement
      const [boxHeading] = screen
        .getAllByRole('heading', { level: 1 })
        .filter((heading) => !bar.contains(heading))
      const box = boxHeading.closest('[class*="md:sticky"]') as HTMLElement
      // The box steps aside below md, so exactly one h1 is displayed there.
      expect(box).toHaveClass('max-md:hidden')

      const count = screen
        .getAllByText('1 post')
        .find((element) => !box.contains(element)) as HTMLElement
      expect(count).toHaveClass('md:hidden')
      // The bar and the count are siblings in the page's own 24px stack, as
      // they were before the box replaced the old heading row.
      expect(count.parentElement).toBe(bar.parentElement)
    })

    it.each([
      { postCount: 0, label: '0 posts' },
      { postCount: 1, label: '1 post' },
      { postCount: 2, label: '2 posts' }
    ])('pluralises the count ($label)', ({ postCount, label }) => {
      renderSignedIn({ postCount })

      expect(screen.getAllByText(label)).toHaveLength(2)
    })

    it('keeps the in-content heading and no chrome without a navigation provider', () => {
      const { container } = render(<HashtagTimeline {...baseProps} />)

      expect(
        container.querySelector('[data-mobile-compact-header]')
      ).not.toBeInTheDocument()
      // Logged out is `PublicShell`'s column at every width: no sticky box.
      expect(container.querySelector('[class*="sticky"]')).toBeNull()
      const heading = screen.getByRole('heading', {
        level: 1,
        name: baseProps.tag
      })
      expect(heading).toBeInTheDocument()
      expect(screen.getByText('1 post')).not.toHaveClass('md:hidden')
    })
  })

  describe('empty state', () => {
    it('invites the first post when there are no statuses and nothing more to load', () => {
      render(<HashtagTimeline {...baseProps} statuses={[]} postCount={0} />)

      expect(
        screen.getByRole('heading', {
          level: 2,
          name: 'No posts with #fediverse'
        })
      ).toBeInTheDocument()
      expect(screen.queryByTestId('posts')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Load more' })
      ).not.toBeInTheDocument()
    })
  })

  describe('loading more statuses', () => {
    type TimelinePage = Awaited<ReturnType<typeof getHashtagTimeline>>
    const loadMore = vi.mocked(getHashtagTimeline)
    const clickLoadMore = async () => {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
      })
    }

    beforeEach(() => {
      loadMore.mockReset()
    })

    it('appends the next page, paging from the last status when no cursor was given', async () => {
      loadMore.mockResolvedValue({
        statuses: [createStatus('status-2')],
        nextMaxStatusId: null
      } as unknown as TimelinePage)
      render(
        <HashtagTimeline {...baseProps} statuses={[createStatus('status-1')]} />
      )

      await clickLoadMore()

      expect(loadMore).toHaveBeenCalledWith({
        tag: 'fediverse',
        maxStatusId: 'status-1'
      })
      expect(screen.getByTestId('post-status-1')).toBeInTheDocument()
      expect(screen.getByTestId('post-status-2')).toBeInTheDocument()
    })

    it('pages from the server-provided cursor and then from the cursor of each result', async () => {
      loadMore
        .mockResolvedValueOnce({
          statuses: [createStatus('status-2')],
          nextMaxStatusId: 'cursor-2'
        } as unknown as TimelinePage)
        .mockResolvedValueOnce({
          statuses: [createStatus('status-3')],
          nextMaxStatusId: null
        } as unknown as TimelinePage)
      render(
        <HashtagTimeline
          {...baseProps}
          statuses={[createStatus('status-1')]}
          nextMaxStatusId="cursor-1"
        />
      )

      await clickLoadMore()
      await clickLoadMore()

      expect(loadMore).toHaveBeenNthCalledWith(1, {
        tag: 'fediverse',
        maxStatusId: 'cursor-1'
      })
      expect(loadMore).toHaveBeenNthCalledWith(2, {
        tag: 'fediverse',
        maxStatusId: 'cursor-2'
      })
      expect(screen.getByTestId('post-status-3')).toBeInTheDocument()
    })

    it('loads from the cursor when the first page is empty but more exist', async () => {
      loadMore.mockResolvedValue({
        statuses: [createStatus('status-9')],
        nextMaxStatusId: null
      } as unknown as TimelinePage)
      render(
        <HashtagTimeline
          {...baseProps}
          statuses={[]}
          postCount={0}
          nextMaxStatusId="cursor-1"
        />
      )

      expect(screen.getByText('No posts with #fediverse')).toBeInTheDocument()
      await clickLoadMore()

      expect(loadMore).toHaveBeenCalledWith({
        tag: 'fediverse',
        maxStatusId: 'cursor-1'
      })
      expect(screen.getByTestId('post-status-9')).toBeInTheDocument()
    })

    it('skips ahead without appending when a page is empty but has a cursor', async () => {
      loadMore
        .mockResolvedValueOnce({
          statuses: [],
          nextMaxStatusId: 'cursor-skip'
        } as unknown as TimelinePage)
        .mockResolvedValueOnce({
          statuses: [createStatus('status-5')],
          nextMaxStatusId: null
        } as unknown as TimelinePage)
      render(
        <HashtagTimeline {...baseProps} statuses={[createStatus('status-1')]} />
      )

      await clickLoadMore()
      expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled()
      await clickLoadMore()

      expect(loadMore).toHaveBeenNthCalledWith(2, {
        tag: 'fediverse',
        maxStatusId: 'cursor-skip'
      })
      expect(screen.getByTestId('post-status-5')).toBeInTheDocument()
    })

    it('removes the Load more button once an empty page has no cursor', async () => {
      loadMore.mockResolvedValue({
        statuses: [],
        nextMaxStatusId: null
      } as unknown as TimelinePage)
      render(
        <HashtagTimeline {...baseProps} statuses={[createStatus('status-1')]} />
      )

      await clickLoadMore()

      expect(
        screen.queryByRole('button', { name: 'Load more' })
      ).not.toBeInTheDocument()
      expect(screen.getByTestId('post-status-1')).toBeInTheDocument()
    })

    it('keeps the posts and lets the reader retry when loading fails', async () => {
      loadMore
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValueOnce({
          statuses: [createStatus('status-2')],
          nextMaxStatusId: null
        } as unknown as TimelinePage)
      render(
        <HashtagTimeline {...baseProps} statuses={[createStatus('status-1')]} />
      )

      await clickLoadMore()

      expect(screen.getByTestId('post-status-1')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled()

      await clickLoadMore()

      expect(screen.getByTestId('post-status-2')).toBeInTheDocument()
    })

    it('shows a disabled busy button while loading', async () => {
      const pending = createDeferred<TimelinePage>()
      loadMore.mockReturnValue(pending.promise)
      render(
        <HashtagTimeline {...baseProps} statuses={[createStatus('status-1')]} />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
      const busy = await screen.findByRole('button', { name: 'Loading more' })
      expect(busy).toBeDisabled()

      await act(async () => {
        pending.resolve({
          statuses: [createStatus('status-2')],
          nextMaxStatusId: null
        } as unknown as TimelinePage)
      })
      expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled()
    })
  })
})
