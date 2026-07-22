/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReactNode } from 'react'

import { getActorStatuses } from '@/lib/client'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusType } from '@/lib/types/domain/status'

import { ActorTimelines } from './ActorTimelines'

vi.mock('@/lib/client', () => ({
  getActorStatuses: vi.fn()
}))

vi.mock('@/lib/components/posts/posts', () => ({
  Posts: ({
    statuses,
    currentTime,
    showActions,
    showReadOnlyStats,
    onStatusCreated,
    onPostUpdated,
    onPostDeleted,
    onLikeChanged,
    onBookmarkChanged
  }: {
    statuses: Status[]
    currentTime: number
    showActions?: boolean
    showReadOnlyStats?: boolean
    onStatusCreated?: (status: Status) => void
    onPostUpdated?: (status: Status) => void
    onPostDeleted?: (status: Status) => void
    onLikeChanged?: (status: Status, isLiked: boolean) => void
    onBookmarkChanged?: (status: Status, isBookmarked: boolean) => void
  }) => (
    <div>
      <div data-testid="posts-current-time">{currentTime}</div>
      <div data-testid="posts-show-actions">{String(Boolean(showActions))}</div>
      <div data-testid="posts-read-only-stats">
        {String(Boolean(showReadOnlyStats))}
      </div>
      {onStatusCreated && (
        <button
          data-testid="trigger-reply-created"
          onClick={() =>
            onStatusCreated(
              createReplyStatus('https://local.example/statuses/new-reply')
            )
          }
        >
          trigger reply created
        </button>
      )}
      {statuses.map((status) => {
        // For a boost, the action callbacks fire with the unwrapped original
        // status (mirroring the real Posts/Actions wiring).
        const target =
          status.type === StatusType.enum.Announce
            ? status.originalStatus
            : status
        return (
          <div key={status.id}>
            <span>{status.id}</span>
            <span data-testid={`like-flag-${target.id}`}>
              {String(target.isActorLiked)}:{target.totalLikes}
            </span>
            <span data-testid={`bookmark-flag-${target.id}`}>
              {String(target.isActorBookmarked)}
            </span>
            <button
              data-testid={`trigger-delete-${target.id}`}
              onClick={() => onPostDeleted?.(target)}
            >
              delete
            </button>
            <button
              data-testid={`trigger-like-${target.id}`}
              onClick={() => onLikeChanged?.(target, !target.isActorLiked)}
            >
              like
            </button>
            <button
              data-testid={`trigger-bookmark-${target.id}`}
              onClick={() =>
                onBookmarkChanged?.(target, !target.isActorBookmarked)
              }
            >
              bookmark
            </button>
            <button
              data-testid={`trigger-update-${target.id}`}
              onClick={() => onPostUpdated?.({ ...target, totalLikes: 99 })}
            >
              update
            </button>
          </div>
        )
      })}
    </div>
  )
}))

vi.mock('./ActorMediaGallery', () => ({
  ActorMediaGallery: () => null
}))

vi.mock('@/lib/components/ui/tabs', () => ({
  Tabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: ReactNode }) => (
    <button>{children}</button>
  )
}))

vi.mock('@/lib/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
  }) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}))

const createStatus = (id: string, overrides: Partial<Status> = {}): Status => {
  const now = new Date('2026-04-30T10:00:00.000Z').getTime()
  return {
    id,
    actorId: 'https://remote.example/users/actor',
    actor: null,
    to: [],
    cc: [],
    edits: [],
    isLocalActor: false,
    createdAt: now,
    updatedAt: now,
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
  } as Status
}

const createReplyStatus = (id: string): Status =>
  createStatus(id, { reply: 'https://remote.example/statuses/parent' })

const createAnnounceStatus = (id: string, original: Status): Status =>
  ({
    ...createStatus(id),
    type: StatusType.enum.Announce,
    originalStatus: original
  }) as Status

const createFitnessStatus = (id: string): Status =>
  createStatus(id, {
    fitness: {
      id: `${id}-fit`,
      fileName: 'morning-run.fit',
      fileType: 'fit',
      mimeType: 'application/octet-stream',
      bytes: 1024,
      url: `${id}/morning-run.fit`
    }
  } as Partial<Status>)

const currentActorProfile = {
  id: 'https://local.example/users/me'
} as ActorProfile

const FIXED_CURRENT_TIME = new Date('2026-04-30T10:05:00.000Z').getTime()

describe('ActorTimelines', () => {
  const getActorStatusesMock = getActorStatuses as jest.Mock

  beforeEach(() => {
    getActorStatusesMock.mockReset()
  })

  it('loads and appends older actor statuses from the next outbox page', async () => {
    getActorStatusesMock.mockResolvedValue({
      statuses: [createStatus('https://remote.example/statuses/older')],
      statusesCount: 2,
      nextPageUrl: null,
      prevPageUrl: 'https://remote.example/users/actor/outbox?page=true'
    })

    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[createStatus('https://remote.example/statuses/newer')]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        statusPagination={{
          nextPageUrl:
            'https://remote.example/users/actor/outbox?page=true&max_id=1',
          prevPageUrl: null
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() => {
      expect(getActorStatusesMock).toHaveBeenCalledWith({
        actorId: 'https://remote.example/users/actor',
        pageUrl: 'https://remote.example/users/actor/outbox?page=true&max_id=1'
      })
    })
    expect(
      screen.getAllByText('https://remote.example/statuses/older')
    ).toHaveLength(1)
    expect(
      screen.queryByRole('button', { name: 'Load more' })
    ).not.toBeInTheDocument()
  })

  it('continues to the next cursor when an outbox page has no renderable statuses', async () => {
    getActorStatusesMock
      .mockResolvedValueOnce({
        statuses: [],
        statusesCount: 3,
        nextPageUrl:
          'https://remote.example/users/actor/outbox?page=true&max_id=2',
        prevPageUrl: 'https://remote.example/users/actor/outbox?page=true'
      })
      .mockResolvedValueOnce({
        statuses: [createStatus('https://remote.example/statuses/oldest')],
        statusesCount: 3,
        nextPageUrl: null,
        prevPageUrl:
          'https://remote.example/users/actor/outbox?page=true&max_id=1'
      })

    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[createStatus('https://remote.example/statuses/newer')]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        statusPagination={{
          nextPageUrl:
            'https://remote.example/users/actor/outbox?page=true&max_id=1',
          prevPageUrl: null
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() => {
      expect(getActorStatusesMock).toHaveBeenCalledTimes(2)
    })
    expect(getActorStatusesMock).toHaveBeenNthCalledWith(1, {
      actorId: 'https://remote.example/users/actor',
      pageUrl: 'https://remote.example/users/actor/outbox?page=true&max_id=1'
    })
    expect(getActorStatusesMock).toHaveBeenNthCalledWith(2, {
      actorId: 'https://remote.example/users/actor',
      pageUrl: 'https://remote.example/users/actor/outbox?page=true&max_id=2'
    })
    expect(
      screen.getAllByText('https://remote.example/statuses/oldest')
    ).toHaveLength(1)
  })

  it('shows load more when the initial actor page has no renderable statuses', async () => {
    getActorStatusesMock.mockResolvedValue({
      statuses: [createStatus('https://remote.example/statuses/first-post')],
      statusesCount: 3,
      nextPageUrl: null,
      prevPageUrl: 'https://remote.example/users/actor/outbox?page=true'
    })

    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        statusPagination={{
          nextPageUrl:
            'https://remote.example/users/actor/outbox?page=true&max_id=1',
          prevPageUrl: null
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() => {
      expect(getActorStatusesMock).toHaveBeenCalledWith({
        actorId: 'https://remote.example/users/actor',
        pageUrl: 'https://remote.example/users/actor/outbox?page=true&max_id=1'
      })
    })
    expect(
      screen.getAllByText('https://remote.example/statuses/first-post')
    ).toHaveLength(1)
  })

  it('shows a retryable error when loading older statuses fails', async () => {
    getActorStatusesMock.mockRejectedValueOnce(new Error('Network error'))

    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[createStatus('https://remote.example/statuses/newer')]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        statusPagination={{
          nextPageUrl:
            'https://remote.example/users/actor/outbox?page=true&max_id=1',
          prevPageUrl: null
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Failed to load more posts. Please try again.'
      )
    })
    expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled()
  })

  it('stops loading when an empty outbox page repeats the same cursor', async () => {
    const repeatedPageUrl =
      'https://remote.example/users/actor/outbox?page=true&max_id=1'

    getActorStatusesMock.mockResolvedValueOnce({
      statuses: [],
      statusesCount: 3,
      nextPageUrl: repeatedPageUrl,
      prevPageUrl: 'https://remote.example/users/actor/outbox?page=true'
    })

    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[createStatus('https://remote.example/statuses/newer')]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        statusPagination={{
          nextPageUrl: repeatedPageUrl,
          prevPageUrl: null
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() => {
      expect(getActorStatusesMock).toHaveBeenCalledTimes(1)
    })
    expect(
      screen.queryByRole('button', { name: 'Load more' })
    ).not.toBeInTheDocument()
  })

  it('renders posts using the currentTime prop, not a freshly computed Date.now()', () => {
    // Regression test for React hydration mismatch (error #418): the relative
    // timestamps in Posts must derive from the server-provided currentTime prop
    // so the SSR and client-hydration output match. Computing Date.now() inside
    // this client component produces a different value on the client and breaks
    // hydration.
    const dateNowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValue(FIXED_CURRENT_TIME + 5 * 60 * 1000)

    try {
      render(
        <ActorTimelines
          host="localhost:3000"
          actorId="https://remote.example/users/actor"
          statuses={[createStatus('https://remote.example/statuses/newer')]}
          attachments={[]}
          currentTime={FIXED_CURRENT_TIME}
          statusPagination={{
            nextPageUrl: null,
            prevPageUrl: null
          }}
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

  it('enables interactive post actions when a current actor is provided', () => {
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[createStatus('https://remote.example/statuses/post')]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        currentActor={currentActorProfile}
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    for (const node of screen.getAllByTestId('posts-show-actions')) {
      expect(node).toHaveTextContent('true')
    }
    for (const node of screen.getAllByTestId('posts-read-only-stats')) {
      expect(node).toHaveTextContent('false')
    }
  })

  it('renders read-only engagement stats for logged-out viewers', () => {
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[createStatus('https://remote.example/statuses/post')]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    for (const node of screen.getAllByTestId('posts-show-actions')) {
      expect(node).toHaveTextContent('false')
    }
    for (const node of screen.getAllByTestId('posts-read-only-stats')) {
      expect(node).toHaveTextContent('true')
    }
  })

  it('separates replies from posts across the Posts and Replies tabs', () => {
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[
          createStatus('https://remote.example/statuses/post'),
          createReplyStatus('https://remote.example/statuses/reply')
        ]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    // The Tabs primitive is mocked to render every tab panel, so a post shows
    // up only under Posts and a reply only under Replies (one occurrence each).
    expect(
      screen.getAllByText('https://remote.example/statuses/post')
    ).toHaveLength(1)
    expect(
      screen.getAllByText('https://remote.example/statuses/reply')
    ).toHaveLength(1)
  })

  it('omits the Fitness tab when the actor has no fitness data', () => {
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[createStatus('https://remote.example/statuses/post')]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    expect(
      screen.queryByRole('button', { name: 'Fitness' })
    ).not.toBeInTheDocument()
  })

  it('shows fitness posts under the Fitness tab when the actor has fitness data', () => {
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[
          createStatus('https://remote.example/statuses/post'),
          createFitnessStatus('https://remote.example/statuses/run')
        ]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        hasFitnessData
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    expect(screen.getByRole('button', { name: 'Fitness' })).toBeInTheDocument()
    // The fitness status appears under both Posts (it is a non-reply note) and
    // the Fitness tab, so it renders twice with the all-panels Tabs mock.
    expect(
      screen.getAllByText('https://remote.example/statuses/run')
    ).toHaveLength(2)
  })

  it('surfaces a newly created reply on the viewer’s own profile', () => {
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://local.example/users/me"
        statuses={[createStatus('https://local.example/statuses/post')]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        currentActor={currentActorProfile}
        isCurrentUser
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    expect(
      screen.queryByText('https://local.example/statuses/new-reply')
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByTestId('trigger-reply-created')[0])

    // The new reply is a reply, so it lands under the Replies tab feed.
    expect(
      screen.getByText('https://local.example/statuses/new-reply')
    ).toBeInTheDocument()
  })

  it('does not inject a reply into another actor’s profile feed', () => {
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[createStatus('https://remote.example/statuses/post')]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        currentActor={currentActorProfile}
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    fireEvent.click(screen.getAllByTestId('trigger-reply-created')[0])

    expect(
      screen.queryByText('https://local.example/statuses/new-reply')
    ).not.toBeInTheDocument()
  })

  it('replaces an edited post in place across the feed', () => {
    const postId = 'https://remote.example/statuses/editable'
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[createStatus(postId)]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        currentActor={currentActorProfile}
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    expect(screen.getByTestId(`like-flag-${postId}`)).toHaveTextContent(
      'false:0'
    )

    fireEvent.click(screen.getByTestId(`trigger-update-${postId}`))

    expect(screen.getByTestId(`like-flag-${postId}`)).toHaveTextContent(
      'false:99'
    )
  })

  it('keeps like state in sync across the feed when a post is liked', () => {
    const postId = 'https://remote.example/statuses/likeable'
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[createStatus(postId)]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        currentActor={currentActorProfile}
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    expect(screen.getByTestId(`like-flag-${postId}`)).toHaveTextContent(
      'false:0'
    )

    fireEvent.click(screen.getByTestId(`trigger-like-${postId}`))

    expect(screen.getByTestId(`like-flag-${postId}`)).toHaveTextContent(
      'true:1'
    )
  })

  it('keeps bookmark state in sync across the feed when a post is bookmarked', () => {
    const postId = 'https://remote.example/statuses/bookmarkable'
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://remote.example/users/actor"
        statuses={[createStatus(postId)]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        currentActor={currentActorProfile}
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    expect(screen.getByTestId(`bookmark-flag-${postId}`)).toHaveTextContent(
      'false'
    )

    fireEvent.click(screen.getByTestId(`trigger-bookmark-${postId}`))

    expect(screen.getByTestId(`bookmark-flag-${postId}`)).toHaveTextContent(
      'true'
    )
  })

  it('removes a boost of a post when that post is deleted', () => {
    const originalId = 'https://local.example/statuses/original'
    const boostId = 'https://local.example/statuses/boost'
    const original = createStatus(originalId)
    render(
      <ActorTimelines
        host="localhost:3000"
        actorId="https://local.example/users/me"
        statuses={[createAnnounceStatus(boostId, original), original]}
        attachments={[]}
        currentTime={FIXED_CURRENT_TIME}
        currentActor={currentActorProfile}
        isCurrentUser
        statusPagination={{ nextPageUrl: null, prevPageUrl: null }}
      />
    )

    expect(screen.getByText(boostId)).toBeInTheDocument()
    expect(screen.getByText(originalId)).toBeInTheDocument()

    fireEvent.click(screen.getAllByTestId(`trigger-delete-${originalId}`)[0])

    expect(screen.queryByText(boostId)).not.toBeInTheDocument()
    expect(screen.queryByText(originalId)).not.toBeInTheDocument()
  })
})
