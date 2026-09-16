/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReactNode } from 'react'

import { getTimeline } from '@/lib/client'
import { Timeline } from '@/lib/services/timelines/types'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import {
  Status,
  StatusAnnounce,
  StatusNote,
  StatusType
} from '@/lib/types/domain/status'

import { MainPageTimeline } from './MainPageTimeline'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn()
  })
}))

vi.mock('@/lib/client', () => ({
  getTimeline: vi.fn()
}))

vi.mock('@/lib/components/announcements/AnnouncementBanner', () => ({
  AnnouncementBanner: () => null
}))

vi.mock('@/lib/components/page-header', () => ({
  PageHeader: ({ actions }: { actions?: ReactNode }) => <div>{actions}</div>
}))

vi.mock('@/lib/components/post-box/post-box', () => ({
  PostBox: () => null
}))

vi.mock('@/lib/components/scroll-to-top-button', () => ({
  ScrollToTopButton: () => null
}))

const { MockFeed } = vi.hoisted(() => {
  const MockFeed = ({
    statuses,
    currentTime,
    onPostDeleted,
    onPostUpdated,
    onLikeChanged,
    onBookmarkChanged,
    onReactionsChanged,
    onReplyCreated
  }: {
    statuses: any[]
    currentTime: number
    onPostDeleted?: (status: any) => void
    onPostUpdated?: (status: any) => void
    onLikeChanged?: (status: any, isLiked: boolean) => void
    onBookmarkChanged?: (status: any, isBookmarked: boolean) => void
    onReactionsChanged?: (status: any, reactions: any[]) => void
    onReplyCreated?: (status: any) => void
  }) => (
    <div>
      <div data-testid="posts-current-time">{currentTime}</div>
      <button
        type="button"
        data-testid="trigger-delete-unknown"
        onClick={() =>
          onPostDeleted?.({
            id: 'https://activities.local/users/llun/s/unknown',
            actorId: 'https://activities.local/users/llun',
            actor: null,
            to: [],
            cc: [],
            edits: [],
            isLocalActor: true,
            createdAt: 0,
            updatedAt: 0,
            type: 'note',
            url: 'https://activities.local/users/llun/s/unknown',
            text: 'unknown',
            summary: null,
            reply: '',
            replies: [],
            actorAnnounceStatusId: null,
            isActorLiked: false,
            isActorBookmarked: false,
            totalLikes: 0,
            totalShares: 0,
            attachments: [],
            tags: []
          })
        }
      >
        delete unknown
      </button>
      <button
        type="button"
        data-testid="trigger-reply-created"
        onClick={() => {
          if (statuses.length > 0) {
            const first = statuses[0]
            const target =
              first.type === 'Announce' ? first.originalStatus : first
            onReplyCreated?.({
              id: 'https://activities.local/users/other/statuses/new-reply-1',
              actorId: 'https://activities.local/users/other',
              type: 'note',
              reply: target.id,
              text: 'A brand new reply',
              createdAt: 1000,
              totalReplies: 0,
              totalLikes: 0,
              totalShares: 0
            })
          }
        }}
      >
        reply created
      </button>
      {statuses.map((status) => {
        const target = (
          status.type === 'Announce' ? status.originalStatus : status
        ) as any
        return (
          <div key={status.id} data-testid={`post-${status.id}`}>
            <span data-testid={`post-id-${status.id}`}>{status.id}</span>
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
            <span data-testid={`post-playback-${status.id}`}>
              {target.attachments?.[0]?.playbackType ?? 'none'}
            </span>
            <span data-testid={`post-replies-${status.id}`}>
              {target.totalReplies ?? 0}
            </span>
            <button
              type="button"
              data-testid={`trigger-reply-${status.id}`}
              onClick={() =>
                onReplyCreated?.({
                  id: `https://activities.local/users/other/statuses/reply-to-${status.id}`,
                  actorId: 'https://activities.local/users/other',
                  type: 'note',
                  reply: target.id,
                  text: 'reply text',
                  createdAt: 1000,
                  totalReplies: 0,
                  totalLikes: 0,
                  totalShares: 0
                })
              }
            >
              reply status
            </button>
            <button
              type="button"
              data-testid={`trigger-delete-${status.id}`}
              onClick={() => onPostDeleted?.(status)}
            >
              delete status
            </button>
            <button
              type="button"
              data-testid={`trigger-delete-target-${status.id}`}
              onClick={() => onPostDeleted?.(target)}
            >
              delete target
            </button>
            <button
              type="button"
              data-testid={`trigger-delete-clone-${status.id}`}
              onClick={() => onPostDeleted?.({ ...target })}
            >
              delete clone
            </button>
            <button
              type="button"
              data-testid={`trigger-update-${status.id}`}
              onClick={() =>
                onPostUpdated?.({ ...target, text: 'updated text' } as any)
              }
            >
              update status
            </button>
            <button
              type="button"
              data-testid={`trigger-like-${status.id}`}
              onClick={() => onLikeChanged?.(target as any, true)}
            >
              like status
            </button>
            <button
              type="button"
              data-testid={`trigger-unlike-${status.id}`}
              onClick={() => onLikeChanged?.(target as any, false)}
            >
              unlike status
            </button>
            <button
              type="button"
              data-testid={`trigger-bookmark-${status.id}`}
              onClick={() => onBookmarkChanged?.(target as any, true)}
            >
              bookmark status
            </button>
            <button
              type="button"
              data-testid={`trigger-unbookmark-${status.id}`}
              onClick={() => onBookmarkChanged?.(target as any, false)}
            >
              unbookmark status
            </button>
            <button
              type="button"
              data-testid={`trigger-react-${status.id}`}
              onClick={() =>
                onReactionsChanged?.(target as any, [
                  { name: '🎉', count: 1, me: true }
                ])
              }
            >
              react status
            </button>
          </div>
        )
      })}
    </div>
  )
  return { MockFeed }
})

vi.mock('@/lib/components/posts/posts', () => ({
  Posts: MockFeed
}))

vi.mock('@/lib/components/posts/timeline-feed', () => ({
  TimelineFeed: MockFeed
}))

vi.mock('@/lib/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    'aria-label': ariaLabel
  }: {
    children: ReactNode
    onClick?: () => void
    disabled?: boolean
    'aria-label'?: string
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {children}
    </button>
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

const createStatus = (
  id: string,
  overrides: Partial<StatusNote> = {}
): StatusNote => ({
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
  totalShares: 0,
  attachments: [],
  tags: [],
  ...overrides
})

const createAnnounceStatus = (
  id: string,
  originalStatus: Status,
  overrides: Partial<StatusAnnounce> = {}
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
  originalStatus,
  ...overrides
})

let observerCallbacks: ((entries: IntersectionObserverEntry[]) => void)[] = []
const observeMock = vi.fn()
const disconnectMock = vi.fn()

class MockIntersectionObserver {
  callback: (entries: IntersectionObserverEntry[]) => void
  constructor(callback: (entries: IntersectionObserverEntry[]) => void) {
    this.callback = callback
    observerCallbacks.push(callback)
  }
  observe = observeMock
  unobserve = vi.fn()
  disconnect = disconnectMock
}

const triggerIntersection = (isIntersecting: boolean) => {
  act(() => {
    for (const cb of observerCallbacks) {
      cb([{ isIntersecting } as IntersectionObserverEntry])
    }
  })
}

describe('MainPageTimeline', () => {
  beforeAll(() => {
    ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
      MockIntersectionObserver
  })

  beforeEach(() => {
    vi.mocked(getTimeline).mockReset()
    observerCallbacks = []
    observeMock.mockClear()
    disconnectMock.mockClear()
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

  describe('infinite-scroll sentinel observation', () => {
    it('observes sentinel mounted after initially empty feed is refreshed', async () => {
      render(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[]}
          initialNextMaxStatusId={null}
        />
      )

      expect(screen.getByText('Your timeline is empty')).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Load more' })
      ).not.toBeInTheDocument()
      expect(observeMock).not.toHaveBeenCalled()

      // Refresh timeline with new posts and nextMaxStatusId
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      vi.mocked(getTimeline).mockResolvedValueOnce({
        statuses: [post1],
        nextMaxStatusId: 'cursor-after-refresh',
        prevMinStatusId: null
      })

      fireEvent.click(screen.getByRole('button', { name: 'Refresh timeline' }))

      await waitFor(() => {
        expect(
          screen.getByTestId('post-https://activities.local/users/llun/s/1')
        ).toBeInTheDocument()
      })

      // Sentinel should now be mounted and observed
      expect(
        screen.getByRole('button', { name: 'Load more' })
      ).toBeInTheDocument()
      expect(observeMock).toHaveBeenCalledTimes(1)
    })

    it('automatically triggers next-page load when sentinel scrolls into view', async () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      const post2 = createStatus('https://activities.local/users/llun/s/2')

      vi.mocked(getTimeline).mockResolvedValueOnce({
        statuses: [post2],
        nextMaxStatusId: 'cursor-page-2',
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

      expect(observeMock).toHaveBeenCalledTimes(1)

      // Trigger visibility on the observer callback
      triggerIntersection(true)

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

    it('suppresses duplicate concurrent requests on repeated visibility notifications while loading', async () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      const post2 = createStatus('https://activities.local/users/llun/s/2')

      let resolveTimeline: (value: unknown) => void
      const timelinePromise = new Promise((resolve) => {
        resolveTimeline = resolve
      })
      vi.mocked(getTimeline).mockReturnValueOnce(
        timelinePromise as ReturnType<typeof getTimeline>
      )

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

      // Fire intersection multiple times in rapid succession while in-flight
      triggerIntersection(true)
      triggerIntersection(true)
      triggerIntersection(true)

      expect(getTimeline).toHaveBeenCalledTimes(1)

      // Resolve in-flight request
      await act(async () => {
        resolveTimeline!({
          statuses: [post2],
          nextMaxStatusId: null,
          prevMinStatusId: null
        })
      })

      await waitFor(() => {
        expect(
          screen.getByTestId('post-https://activities.local/users/llun/s/2')
        ).toBeInTheDocument()
      })

      expect(getTimeline).toHaveBeenCalledTimes(1)
    })

    it('recovers from request failure allowing manual retry via load-more button', async () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')
      const post2 = createStatus('https://activities.local/users/llun/s/2')

      // First call fails
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

      // Auto-load triggers error
      triggerIntersection(true)

      await waitFor(() => {
        expect(getTimeline).toHaveBeenCalledTimes(1)
      })

      // Load more button remains available and enabled after failure
      const loadMoreBtn = screen.getByRole('button', { name: 'Load more' })
      expect(loadMoreBtn).not.toBeDisabled()

      // Retry manually
      vi.mocked(getTimeline).mockResolvedValueOnce({
        statuses: [post2],
        nextMaxStatusId: null,
        prevMinStatusId: null
      })

      fireEvent.click(loadMoreBtn)

      await waitFor(() => {
        expect(getTimeline).toHaveBeenCalledTimes(2)
      })

      await waitFor(() => {
        expect(
          screen.getByTestId('post-https://activities.local/users/llun/s/2')
        ).toBeInTheDocument()
      })
    })

    it('cleans up observer when sentinel unmounts after pagination is exhausted', async () => {
      const post1 = createStatus('https://activities.local/users/llun/s/1')

      vi.mocked(getTimeline).mockResolvedValueOnce({
        statuses: [],
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

      expect(
        screen.getByRole('button', { name: 'Load more' })
      ).toBeInTheDocument()

      triggerIntersection(true)

      await waitFor(() => {
        expect(getTimeline).toHaveBeenCalledTimes(1)
      })

      // Pagination is exhausted: sentinel unmounts
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Load more' })
        ).not.toBeInTheDocument()
      })

      // Disconnect was called during unmount
      expect(disconnectMock).toHaveBeenCalled()
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

    it('preserves user interaction state when statuses prop updates', () => {
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

      // User interacts with post1: like, bookmark, react
      fireEvent.click(
        screen.getByTestId(
          'trigger-like-https://activities.local/users/llun/s/1'
        )
      )
      fireEvent.click(
        screen.getByTestId(
          'trigger-bookmark-https://activities.local/users/llun/s/1'
        )
      )
      fireEvent.click(
        screen.getByTestId(
          'trigger-react-https://activities.local/users/llun/s/1'
        )
      )

      expect(
        screen.getByTestId('post-liked-https://activities.local/users/llun/s/1')
      ).toHaveTextContent('true')
      expect(
        screen.getByTestId(
          'post-bookmarked-https://activities.local/users/llun/s/1'
        )
      ).toHaveTextContent('true')
      expect(
        screen.getByTestId(
          'post-reactions-https://activities.local/users/llun/s/1'
        )
      ).toHaveTextContent('1')

      // Server prop updates with clean un-liked status, but with enriched playbackType
      const enrichedAtt = createAttachment('att-1', { playbackType: 'gifv' })
      const serverPost1 = createStatus(
        'https://activities.local/users/llun/s/1',
        {
          attachments: [enrichedAtt],
          isActorLiked: false,
          isActorBookmarked: false,
          reactions: []
        }
      )

      rerender(
        <MainPageTimeline
          host="activities.local"
          currentTime={FIXED_CURRENT_TIME}
          profile={profile}
          isMediaUploadEnabled={false}
          statuses={[serverPost1]}
        />
      )

      // Local interaction state is preserved; playbackType is updated
      expect(
        screen.getByTestId('post-liked-https://activities.local/users/llun/s/1')
      ).toHaveTextContent('true')
      expect(
        screen.getByTestId(
          'post-bookmarked-https://activities.local/users/llun/s/1'
        )
      ).toHaveTextContent('true')
      expect(
        screen.getByTestId(
          'post-reactions-https://activities.local/users/llun/s/1'
        )
      ).toHaveTextContent('1')
      expect(
        screen.getByTestId(
          'post-playback-https://activities.local/users/llun/s/1'
        )
      ).toHaveTextContent('gifv')
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

    it('displays polling banner when newer posts are detected, and clicking refreshes top snapshot', async () => {
      vi.useFakeTimers()
      const originalScrollTo = window.scrollTo
      const scrollToMock = vi.fn()
      window.scrollTo = scrollToMock

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

        expect(getTimeline).toHaveBeenCalledWith(
          expect.objectContaining({
            timeline: Timeline.MAIN,
            limit: 5
          })
        )

        const banner = screen.getByRole('button', { name: '2 new posts ↑' })
        expect(banner).toBeInTheDocument()

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
      } finally {
        window.scrollTo = originalScrollTo
        vi.useRealTimers()
      }
    })
  })
})
