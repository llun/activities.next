/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

vi.mock('@/lib/components/posts/posts', () => ({
  Posts: ({ statuses }: { statuses: Status[] }) => (
    <div data-testid="posts">{statuses.length} posts</div>
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

const statuses = [{ id: 's1' }] as unknown as Status[]

const baseProps = {
  host: 'llun.social',
  collection,
  ownerHandle: 'anna@llun.social',
  ownerProfilePath: '/@anna@llun.social',
  totalCount: 2,
  approvedCount: 1,
  ownerRoster: [ownerMember, approvedMember],
  publicRoster: [approvedMember],
  statuses,
  shareUrl: 'https://llun.social/collections/col-1',
  currentTime: 1_700_000_000_000
}

describe('CollectionDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getCollectionFeed as jest.Mock).mockResolvedValue({
      statuses: [{ id: 'p1' }],
      nextMaxStatusId: null,
      prevMinStatusId: null
    })
    ;(getCollectionTimeline as jest.Mock).mockResolvedValue({
      statuses,
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
    // Owner projection shows every member.
    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(screen.getByText('Ben')).toBeInTheDocument()
    expect(screen.getByText('Highlighted accounts · 2')).toBeInTheDocument()
  })

  it('switches to the public preview, fetching the public feed and approved roster', async () => {
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
    // The public roster hides the unapproved member.
    await waitFor(() =>
      expect(screen.queryByText('Ada')).not.toBeInTheDocument()
    )
    expect(screen.getByText('Ben')).toBeInTheDocument()
    expect(screen.getByText('1 hidden by consent')).toBeInTheDocument()
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
