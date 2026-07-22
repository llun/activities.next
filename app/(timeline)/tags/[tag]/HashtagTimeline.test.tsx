/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { ActorProfile } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'

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
    showReadOnlyStats
  }: {
    statuses: Status[]
    showActions?: boolean
    showReadOnlyStats?: boolean
  }) => (
    <div
      data-testid="posts"
      data-show-actions={String(Boolean(showActions))}
      data-read-only-stats={String(Boolean(showReadOnlyStats))}
    >
      {statuses.map((s) => s.id).join(',')}
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

const statuses = [{ id: 'status-1' }] as unknown as Status[]

const baseProps = {
  tag: 'fediverse',
  host: 'llun.social',
  statuses,
  postCount: 1,
  currentTime: 1_700_000_000_000
}

describe('HashtagTimeline', () => {
  it('shows read-only engagement stats for logged-out viewers', () => {
    render(<HashtagTimeline {...baseProps} />)

    const feed = screen.getByTestId('posts')
    expect(feed).toHaveAttribute('data-show-actions', 'false')
    expect(feed).toHaveAttribute('data-read-only-stats', 'true')
  })

  it('enables interactive actions and hides read-only stats when signed in', () => {
    render(<HashtagTimeline {...baseProps} currentActor={{} as ActorProfile} />)

    const feed = screen.getByTestId('posts')
    expect(feed).toHaveAttribute('data-show-actions', 'true')
    expect(feed).toHaveAttribute('data-read-only-stats', 'false')
  })
})
