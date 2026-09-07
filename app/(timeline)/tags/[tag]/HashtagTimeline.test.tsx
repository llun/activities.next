/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

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
})
