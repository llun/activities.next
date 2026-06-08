/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { ReactNode } from 'react'

import { getListTimeline } from '@/lib/client'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusType } from '@/lib/types/domain/status'
import { ListEntity } from '@/lib/types/mastodon/list'

import { ListTimeline } from './ListTimeline'

jest.mock('@/lib/client', () => ({
  getListTimeline: jest.fn()
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() })
}))

jest.mock('@/lib/components/scroll-to-top-button', () => ({
  ScrollToTopButton: () => null
}))

jest.mock('@/lib/components/page-header', () => ({
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

jest.mock('@/lib/components/posts/posts', () => ({
  Posts: ({
    statuses,
    currentTime
  }: {
    statuses: Status[]
    currentTime: number
  }) => (
    <div>
      <div data-testid="posts-current-time">{currentTime}</div>
      {statuses.map((status) => (
        <div key={status.id}>{status.id}</div>
      ))}
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

const createStatus = (id: string): Status => ({
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
  totalLikes: 0,
  attachments: [],
  tags: []
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
    jest.clearAllMocks()
  })

  it('renders posts using the currentTime prop, not a freshly computed Date.now()', () => {
    // Regression test for the React hydration mismatch: the relative timestamps
    // rendered by <Posts> must derive from the server-provided currentTime so
    // SSR and client hydration agree. A freshly computed Date.now() here would
    // diverge from the server value and break hydration.
    const dateNowSpy = jest
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
})
