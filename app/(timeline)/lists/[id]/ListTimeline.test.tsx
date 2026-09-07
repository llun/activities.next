/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { ReactNode } from 'react'

import { getListTimeline } from '@/lib/client'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusAnnounce, StatusType } from '@/lib/types/domain/status'
import { ListEntity } from '@/lib/types/mastodon/list'

import { ListTimeline } from './ListTimeline'

vi.mock('@/lib/client', () => ({
  getListTimeline: vi.fn()
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() })
}))

vi.mock('@/lib/components/scroll-to-top-button', () => ({
  ScrollToTopButton: () => null
}))

vi.mock('@/lib/components/page-header', () => ({
  PageHeader: ({
    title,
    description,
    actions
  }: {
    title: ReactNode
    description: ReactNode
    actions: ReactNode
  }) => (
    <div>
      <div>{title}</div>
      <div>{description}</div>
      <div>{actions}</div>
    </div>
  )
}))

vi.mock('@/lib/components/posts/posts', () => ({
  Posts: ({
    statuses,
    currentTime,
    onPostDeleted,
    onPostUpdated,
    onLikeChanged,
    onBookmarkChanged,
    onReactionsChanged
  }: {
    statuses: Status[]
    currentTime: number
    onPostDeleted?: (status: Status) => void
    onPostUpdated?: (status: Status) => void
    onLikeChanged?: (status: any, isLiked: boolean) => void
    onBookmarkChanged?: (status: any, isBookmarked: boolean) => void
    onReactionsChanged?: (status: any, reactions: any[]) => void
  }) => (
    <div>
      <div data-testid="posts-current-time">{currentTime}</div>
      {statuses.map((status) => {
        const target =
          status.type === StatusType.enum.Announce
            ? status.originalStatus
            : status
        return (
          <div key={status.id} data-testid={`post-${status.id}`}>
            <span data-testid={`post-id-${status.id}`}>id:{status.id}</span>
            <span data-testid={`post-text-${status.id}`}>{target.text}</span>
            <span data-testid={`post-liked-${status.id}`}>
              {String(target.isActorLiked)}
            </span>
            <span data-testid={`post-bookmarked-${status.id}`}>
              {String(target.isActorBookmarked)}
            </span>
            <span data-testid={`post-likes-${status.id}`}>
              {target.totalLikes}
            </span>
            <span data-testid={`post-reactions-${status.id}`}>
              {target.reactions?.length ?? 0}
            </span>
            <button
              type="button"
              data-testid={`trigger-delete-${status.id}`}
              onClick={() => onPostDeleted?.(status)}
            >
              delete
            </button>
            <button
              type="button"
              data-testid={`trigger-update-${status.id}`}
              onClick={() =>
                onPostUpdated?.({ ...target, text: 'updated text' } as any)
              }
            >
              update
            </button>
            <button
              type="button"
              data-testid={`trigger-like-${status.id}`}
              onClick={() => onLikeChanged?.(target as any, true)}
            >
              like
            </button>
            <button
              type="button"
              data-testid={`trigger-unlike-${status.id}`}
              onClick={() => onLikeChanged?.(target as any, false)}
            >
              unlike
            </button>
            <button
              type="button"
              data-testid={`trigger-bookmark-${status.id}`}
              onClick={() => onBookmarkChanged?.(target as any, true)}
            >
              bookmark
            </button>
            <button
              type="button"
              data-testid={`trigger-unbookmark-${status.id}`}
              onClick={() => onBookmarkChanged?.(target as any, false)}
            >
              unbookmark
            </button>
            <button
              type="button"
              data-testid={`trigger-react-${status.id}`}
              onClick={() =>
                onReactionsChanged?.(target as any, [
                  { name: '🔥', count: 1, me: true }
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

const FIXED_CURRENT_TIME = new Date('2026-04-30T10:05:00.000Z').getTime()

const profile: ActorProfile = {
  id: 'https://activities.local/users/llun',
  username: 'llun',
  domain: 'activities.local',
  name: 'Llun',
  followersUrl: 'https://activities.local/users/llun/followers',
  inboxUrl: 'https://activities.local/users/llun/inbox',
  sharedInboxUrl: 'https://activities.local/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: FIXED_CURRENT_TIME
}

const list: ListEntity = {
  id: 'list-1',
  title: 'Running club',
  replies_policy: 'list',
  exclusive: false
}

const createStatus = (id: string, overrides: Partial<Status> = {}): Status => ({
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
  text: id,
  summary: null,
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  isActorBookmarked: false,
  totalLikes: 0,
  attachments: [],
  tags: [],
  ...overrides
})

const createAnnounceStatus = (
  id: string,
  originalStatus: Status
): StatusAnnounce => ({
  id,
  actorId: profile.id,
  actor: profile,
  to: [],
  cc: [],
  edits: [],
  isLocalActor: true,
  createdAt: FIXED_CURRENT_TIME,
  updatedAt: FIXED_CURRENT_TIME,
  type: StatusType.enum.Announce,
  originalStatus
})

class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('ListTimeline', () => {
  beforeAll(() => {
    ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
      MockIntersectionObserver
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders posts using the currentTime prop, not a freshly computed Date.now()', () => {
    // Regression test for the React hydration mismatch: the relative timestamps
    // rendered by <Posts> must derive from the server-provided currentTime so
    // SSR and client hydration agree. A freshly computed Date.now() here would
    // diverge from the server value and break hydration.
    const dateNowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValue(FIXED_CURRENT_TIME + 5 * 60 * 1000)

    try {
      render(
        <ListTimeline
          host="activities.local"
          list={list}
          memberCount={3}
          statuses={[createStatus('https://activities.local/users/llun/s/1')]}
          currentTime={FIXED_CURRENT_TIME}
          currentActor={profile}
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

  it('shows the member count, replies policy and an edit link', () => {
    render(
      <ListTimeline
        host="activities.local"
        list={list}
        memberCount={3}
        statuses={[createStatus('https://activities.local/users/llun/s/1')]}
        currentTime={FIXED_CURRENT_TIME}
        currentActor={profile}
      />
    )

    expect(screen.getByText('3 members · Replies: list')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /edit/i })).toHaveAttribute(
      'href',
      '/lists/list-1/edit'
    )
  })

  it('appends the next page of statuses on load more', async () => {
    ;(getListTimeline as jest.Mock).mockResolvedValue({
      statuses: [createStatus('https://activities.local/users/llun/s/2')],
      nextMaxStatusId: null,
      prevMinStatusId: null
    })

    render(
      <ListTimeline
        host="activities.local"
        list={list}
        memberCount={1}
        statuses={[createStatus('https://activities.local/users/llun/s/1')]}
        currentTime={FIXED_CURRENT_TIME}
        currentActor={profile}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await screen.findByText('https://activities.local/users/llun/s/2')
    expect(getListTimeline).toHaveBeenCalledWith({
      listId: 'list-1',
      maxStatusId: 'https://activities.local/users/llun/s/1'
    })
  })

  describe('status updates and engagement sync', () => {
    it('updates matching status in place on onPostUpdated', () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      render(
        <ListTimeline
          host="activities.local"
          list={list}
          memberCount={1}
          statuses={[post1]}
          currentTime={FIXED_CURRENT_TIME}
          currentActor={profile}
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

    it('updates announce wrapper when original status is updated', () => {
      const original = createStatus('https://activities.local/users/other/s/1')
      const announce = createAnnounceStatus(
        'https://activities.local/users/llun/s/announce-1',
        original
      )

      render(
        <ListTimeline
          host="activities.local"
          list={list}
          memberCount={1}
          statuses={[announce]}
          currentTime={FIXED_CURRENT_TIME}
          currentActor={profile}
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

    it('removes matching status on onPostDeleted', () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      render(
        <ListTimeline
          host="activities.local"
          list={list}
          memberCount={1}
          statuses={[post1]}
          currentTime={FIXED_CURRENT_TIME}
          currentActor={profile}
        />
      )

      expect(
        screen.getByTestId('post-https://activities.local/users/llun/s/1')
      ).toBeInTheDocument()

      fireEvent.click(
        screen.getByTestId(
          'trigger-delete-https://activities.local/users/llun/s/1'
        )
      )

      expect(
        screen.queryByTestId('post-https://activities.local/users/llun/s/1')
      ).not.toBeInTheDocument()
    })

    it('removes announce wrapper when original status is deleted', () => {
      const original = createStatus('https://activities.local/users/other/s/1')
      const announce = createAnnounceStatus(
        'https://activities.local/users/llun/s/announce-1',
        original
      )

      render(
        <ListTimeline
          host="activities.local"
          list={list}
          memberCount={1}
          statuses={[announce]}
          currentTime={FIXED_CURRENT_TIME}
          currentActor={profile}
        />
      )

      expect(
        screen.getByTestId(
          'post-https://activities.local/users/llun/s/announce-1'
        )
      ).toBeInTheDocument()

      fireEvent.click(
        screen.getByTestId(
          'trigger-delete-https://activities.local/users/llun/s/announce-1'
        )
      )

      expect(
        screen.queryByTestId(
          'post-https://activities.local/users/llun/s/announce-1'
        )
      ).not.toBeInTheDocument()
    })

    it('updates like count and liked status when onLikeChanged is triggered', () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      render(
        <ListTimeline
          host="activities.local"
          list={list}
          memberCount={1}
          statuses={[post1]}
          currentTime={FIXED_CURRENT_TIME}
          currentActor={profile}
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
        <ListTimeline
          host="activities.local"
          list={list}
          memberCount={1}
          statuses={[post1]}
          currentTime={FIXED_CURRENT_TIME}
          currentActor={profile}
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
        <ListTimeline
          host="activities.local"
          list={list}
          memberCount={1}
          statuses={[post1]}
          currentTime={FIXED_CURRENT_TIME}
          currentActor={profile}
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
  })
})
