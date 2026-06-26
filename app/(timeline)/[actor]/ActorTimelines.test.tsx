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
    showReadOnlyStats
  }: {
    statuses: Status[]
    currentTime: number
    showActions?: boolean
    showReadOnlyStats?: boolean
  }) => (
    <div>
      <div data-testid="posts-current-time">{currentTime}</div>
      <div data-testid="posts-show-actions">{String(Boolean(showActions))}</div>
      <div data-testid="posts-read-only-stats">
        {String(Boolean(showReadOnlyStats))}
      </div>
      {statuses.map((status) => (
        <div key={status.id}>{status.id}</div>
      ))}
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
    totalLikes: 0,
    attachments: [],
    tags: [],
    ...overrides
  } as Status
}

const createReplyStatus = (id: string): Status =>
  createStatus(id, { reply: 'https://remote.example/statuses/parent' })

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
})
