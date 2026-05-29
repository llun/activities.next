/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { ReactNode } from 'react'

import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusType } from '@/lib/types/domain/status'

import { MainPageTimeline } from './MainPageTimeline'

jest.mock('@/lib/client', () => ({
  getTimeline: jest.fn()
}))

jest.mock('@/lib/components/page-header', () => ({
  PageHeader: () => null
}))

jest.mock('@/lib/components/post-box/post-box', () => ({
  PostBox: () => null
}))

jest.mock('@/lib/components/scroll-to-top-button', () => ({
  ScrollToTopButton: () => null
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

jest.mock('@/lib/components/ui/tabs', () => ({
  Tabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: ReactNode }) => (
    <button>{children}</button>
  )
}))

jest.mock('@/lib/components/ui/button', () => ({
  Button: ({ children }: { children: ReactNode }) => <button>{children}</button>
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

describe('MainPageTimeline', () => {
  beforeAll(() => {
    ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
      MockIntersectionObserver
  })

  it('renders posts using the currentTime prop, not a freshly computed Date.now()', () => {
    // Regression test for React hydration mismatch (error #418): relative
    // timestamps must derive from the server-provided currentTime prop so SSR
    // and client-hydration output match. Computing Date.now() inside this
    // client component yields a different value on the client and breaks
    // hydration.
    const dateNowSpy = jest
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
})
