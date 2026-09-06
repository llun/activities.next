/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReactNode } from 'react'

import { getTimeline } from '@/lib/client'
import { Timeline } from '@/lib/services/timelines/types'
import { ActorProfile } from '@/lib/types/domain/actor'
import {
  Status,
  StatusAnnounce,
  StatusNote,
  StatusType
} from '@/lib/types/domain/status'

import { MainPageTimeline } from './MainPageTimeline'

vi.mock('@/lib/client', () => ({
  getTimeline: vi.fn()
}))

vi.mock('@/lib/components/announcements/AnnouncementBanner', () => ({
  AnnouncementBanner: () => null
}))

vi.mock('@/lib/components/page-header', () => ({
  PageHeader: () => null
}))

vi.mock('@/lib/components/post-box/post-box', () => ({
  PostBox: () => null
}))

vi.mock('@/lib/components/scroll-to-top-button', () => ({
  ScrollToTopButton: () => null
}))

vi.mock('@/lib/components/posts/posts', () => ({
  Posts: ({
    statuses,
    currentTime,
    onPostDeleted
  }: {
    statuses: Status[]
    currentTime: number
    onPostDeleted?: (status: Status) => void
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
            type: StatusType.enum.Note,
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
      {statuses.map((status) => {
        const target =
          status.type === StatusType.enum.Announce
            ? status.originalStatus
            : status
        return (
          <div key={status.id} data-testid={`post-${status.id}`}>
            <span data-testid={`post-id-${status.id}`}>{status.id}</span>
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
          </div>
        )
      })}
    </div>
  )
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

class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('MainPageTimeline', () => {
  beforeAll(() => {
    ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
      MockIntersectionObserver
  })

  beforeEach(() => {
    vi.mocked(getTimeline).mockReset()
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
})
