/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReactNode } from 'react'

import { CollectionMember } from '@/app/(timeline)/collections/CollectionEditor'
import { getCollectionFeed, getCollectionTimeline } from '@/lib/client'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { CollectionEntity } from '@/lib/types/mastodon/collection'

import { CollectionDetail } from './CollectionDetail'

vi.mock('@/lib/client', () => ({
  getCollectionFeed: vi.fn(),
  getCollectionTimeline: vi.fn()
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

// Render the status ids so tests can assert WHICH feed (owner vs public, and
// appended pages) is on screen, not just the count.
vi.mock('@/lib/components/posts/posts', () => ({
  Posts: ({ statuses }: { statuses: Status[] }) => (
    <div data-testid="posts">{statuses.map((s) => s.id).join(',')}</div>
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

const collection: CollectionEntity = {
  id: 'col-1',
  title: 'Fediverse builders',
  description: 'people I read',
  topic: 'fediverse',
  language: null,
  visibility: 'public',
  feed_enabled: true,
  size: 1
}

const ownerMember: CollectionMember = {
  id: 'a1',
  name: 'Ada',
  handle: 'ada@llun.social'
}
const approvedMember: CollectionMember = {
  id: 'b1',
  name: 'Ben',
  handle: 'ben@llun.social'
}

// The owner's initial feed page (passed as a prop, not fetched).
const ownerStatuses = [{ id: 'owner-1' }] as unknown as Status[]

const baseProps = {
  host: 'llun.social',
  collection,
  ownerHandle: 'anna@llun.social',
  ownerProfilePath: '/@anna@llun.social',
  totalCount: 2,
  approvedCount: 1,
  ownerRoster: [ownerMember, approvedMember],
  publicRoster: [approvedMember],
  statuses: ownerStatuses,
  shareUrl: 'https://llun.social/collections/col-1',
  currentTime: 1_700_000_000_000
}

const posts = () => screen.getByTestId('posts').textContent ?? ''

describe('CollectionDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getCollectionFeed as jest.Mock).mockResolvedValue({
      statuses: [{ id: 'pub-1' }],
      nextMaxStatusId: null,
      prevMinStatusId: null
    })
    ;(getCollectionTimeline as jest.Mock).mockResolvedValue({
      statuses: ownerStatuses,
      nextMaxStatusId: null,
      prevMinStatusId: null
    })
  })

  it('shows the owner view with the projection toggle, share link and full roster', () => {
    render(
      <CollectionDetail
        {...baseProps}
        isOwner
        currentActor={{} as ActorProfile}
      />
    )

    expect(
      screen.getByRole('button', { name: /owner view/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /public preview/i })
    ).toBeInTheDocument()
    expect(
      screen.getByText('https://llun.social/collections/col-1')
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /edit/i })).toHaveAttribute(
      'href',
      '/collections/col-1/edit'
    )
    // Owner projection shows every member and the owner's feed.
    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(screen.getByText('Ben')).toBeInTheDocument()
    expect(screen.getByText('Highlighted accounts · 2')).toBeInTheDocument()
    expect(posts()).toContain('owner-1')
  })

  it('switches to the public preview, replacing the feed and roster with the approved set', async () => {
    render(
      <CollectionDetail
        {...baseProps}
        isOwner
        currentActor={{} as ActorProfile}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /public preview/i }))

    await waitFor(() =>
      expect(getCollectionFeed).toHaveBeenCalledWith({
        collectionId: 'col-1',
        maxStatusId: undefined
      })
    )
    // The feed is actually replaced with the public projection's statuses.
    await waitFor(() => expect(posts()).toContain('pub-1'))
    expect(posts()).not.toContain('owner-1')
    // The public roster hides the unapproved member.
    expect(screen.queryByText('Ada')).not.toBeInTheDocument()
    expect(screen.getByText('Ben')).toBeInTheDocument()
    expect(screen.getByText('1 hidden by consent')).toBeInTheDocument()
  })

  it('appends the next page via load more on the current projection', async () => {
    ;(getCollectionTimeline as jest.Mock).mockResolvedValue({
      statuses: [{ id: 'owner-2' }],
      nextMaxStatusId: null,
      prevMinStatusId: null
    })
    render(
      <CollectionDetail
        {...baseProps}
        isOwner
        currentActor={{} as ActorProfile}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /load more/i }))

    await waitFor(() =>
      expect(getCollectionTimeline).toHaveBeenCalledWith({
        collectionId: 'col-1',
        maxStatusId: 'owner-1'
      })
    )
    await waitFor(() => expect(posts()).toContain('owner-2'))
    // The earlier page is kept and the new page appended.
    expect(posts()).toContain('owner-1')
  })

  it('ignores a stale load-more response that resolves after a projection switch', async () => {
    // Hold the owner-feed load-more request open so it resolves AFTER the
    // projection switch — the requestId guard must drop its (now stale) result.
    let resolveOwner: (value: unknown) => void = () => {}
    const ownerPending = new Promise((resolve) => {
      resolveOwner = resolve
    })
    ;(getCollectionTimeline as jest.Mock).mockReturnValue(ownerPending)

    render(
      <CollectionDetail
        {...baseProps}
        isOwner
        currentActor={{} as ActorProfile}
      />
    )

    // Start an owner-projection load-more (stays in flight).
    fireEvent.click(screen.getByRole('button', { name: /load more/i }))
    await waitFor(() => expect(getCollectionTimeline).toHaveBeenCalled())

    // Switch to the public preview; its feed resolves first and wins.
    fireEvent.click(screen.getByRole('button', { name: /public preview/i }))
    await waitFor(() => expect(posts()).toContain('pub-1'))

    // Now let the stale owner request resolve — it must NOT be applied.
    await act(async () => {
      resolveOwner({
        statuses: [{ id: 'owner-stale' }],
        nextMaxStatusId: null,
        prevMinStatusId: null
      })
      await Promise.resolve()
    })

    expect(posts()).toContain('pub-1')
    expect(posts()).not.toContain('owner-stale')
  })

  it('renders a read-only public view for non-owners', () => {
    render(<CollectionDetail {...baseProps} isOwner={false} />)

    expect(
      screen.queryByRole('button', { name: /public preview/i })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /edit/i })
    ).not.toBeInTheDocument()
    expect(screen.getByText('by anna@llun.social')).toBeInTheDocument()
    // Public viewers see only the approved roster.
    expect(screen.getByText('Ben')).toBeInTheDocument()
    expect(screen.queryByText('Ada')).not.toBeInTheDocument()
  })
})
