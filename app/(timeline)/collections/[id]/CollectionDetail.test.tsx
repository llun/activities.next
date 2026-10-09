/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { ReactNode } from 'react'

import { CollectionMember } from '@/app/(timeline)/collections/CollectionEditor'
import { getCollectionFeed, getCollectionTimeline } from '@/lib/client'
import {
  MOBILE_FEED_SURFACE_CLASS,
  MOBILE_INSET_CARD_FRAME_CLASS,
  MOBILE_INSET_FEED_CLASS
} from '@/lib/components/posts/feedLayout'
import { createDeferred } from '@/lib/testing/deferred'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { CollectionEntity } from '@/lib/types/mastodon/collection'

import { CollectionDetail } from './CollectionDetail'

vi.mock('@/lib/client', () => ({
  getCollectionFeed: vi.fn(),
  getCollectionTimeline: vi.fn()
}))

// `back` and `compactTitle` surface as data attributes, so the mobile chrome
// the page asks for is observable without rendering the real header.
vi.mock('@/lib/components/page-header', () => ({
  PageHeader: ({
    title,
    description,
    actions,
    back,
    compactTitle
  }: {
    title: ReactNode
    description: ReactNode
    actions: ReactNode
    back?: { href: string; accessibleName: string }
    compactTitle?: string
  }) => (
    <div
      data-testid="page-header"
      data-back-href={back?.href}
      data-back-name={back?.accessibleName}
      data-compact-title={compactTitle}
    >
      <div>{title}</div>
      <div>{description}</div>
      <div>{actions}</div>
    </div>
  )
}))

// Render the status ids so tests can assert WHICH feed (owner vs public, and
// appended pages) is on screen, not just the count. The showActions /
// showReadOnlyStats flags are surfaced as data attributes (not child nodes) so
// the `posts()` textContent helper keeps returning just the status ids.
vi.mock('@/lib/components/posts/posts', () => ({
  Posts: ({
    statuses,
    showActions,
    showReadOnlyStats,
    className
  }: {
    statuses: Status[]
    showActions?: boolean
    showReadOnlyStats?: boolean
    className?: string
  }) => (
    <div
      data-testid="posts"
      className={className}
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
    // The owner came from /lists; the mobile bar names the section.
    const header = screen.getByTestId('page-header')
    expect(header).toHaveAttribute('data-back-href', '/lists')
    expect(header).toHaveAttribute(
      'data-back-name',
      'Back to lists and collections'
    )
    expect(header).toHaveAttribute('data-compact-title', 'Collection')
  })

  it('shows the visibility and the topic of the collection', () => {
    render(
      <CollectionDetail
        {...baseProps}
        isOwner
        currentActor={{} as ActorProfile}
      />
    )

    // `text-primary` fails AA as a foreground; `text-primary-text` clears it.
    expect(screen.getByText('fediverse')).toHaveClass('text-primary-text')
    expect(screen.getByText('Public', { selector: 'span' })).toBeInTheDocument()
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
    const ownerPending = createDeferred<unknown>()
    ;(getCollectionTimeline as jest.Mock).mockReturnValue(ownerPending.promise)

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
      ownerPending.resolve({
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
    render(
      <CollectionDetail
        {...baseProps}
        isOwner={false}
        currentActor={{} as ActorProfile}
      />
    )

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
    // /lists is the owner's index, so a visitor gets no Back to it.
    const header = screen.getByTestId('page-header')
    expect(header).not.toHaveAttribute('data-back-href')
    expect(header).toHaveAttribute('data-compact-title', 'Collection')
  })

  // A signed-in non-owner has no Back, so `PageHeader` would not truncate a
  // plain title: from `md` up the heading stays the truncating one it always
  // was, and below `md` (under the bar) it wraps.
  it('truncates a signed-in non-owner heading from md and wraps it below', () => {
    render(
      <CollectionDetail
        {...baseProps}
        isOwner={false}
        currentActor={{} as ActorProfile}
      />
    )

    const title = screen.getByText('Fediverse builders', {
      selector: '[data-testid="page-header"] *'
    })
    expect(title).toHaveClass(
      'truncate',
      'max-md:break-words',
      'max-md:whitespace-normal'
    )
    expect(title.parentElement).toHaveClass('flex', 'items-center', 'gap-2')
  })

  it('leaves the owner heading plain for PageHeader to truncate beside its Back', () => {
    render(
      <CollectionDetail
        {...baseProps}
        isOwner
        currentActor={{} as ActorProfile}
      />
    )

    const title = screen.getByText('Fediverse builders', {
      selector: '[data-testid="page-header"] *'
    })
    expect(title).not.toHaveClass('truncate')
    expect(title.parentElement).not.toHaveClass('flex')
  })

  it.each([
    {
      description: 'shows read-only engagement stats for logged-out viewers',
      currentActor: undefined,
      showActions: 'false',
      readOnlyStats: 'true'
    },
    {
      description:
        'enables interactive actions and hides read-only stats when signed in',
      currentActor: {} as ActorProfile,
      showActions: 'true',
      readOnlyStats: 'false'
    }
  ])('$description', ({ currentActor, showActions, readOnlyStats }) => {
    render(
      <CollectionDetail
        {...baseProps}
        isOwner={false}
        currentActor={currentActor}
      />
    )

    const feed = screen.getByTestId('posts')
    expect(feed).toHaveAttribute('data-show-actions', showActions)
    expect(feed).toHaveAttribute('data-read-only-stats', readOnlyStats)
  })

  describe('logged-out visitor', () => {
    const renderLoggedOut = (props = {}) =>
      render(<CollectionDetail {...baseProps} isOwner={false} {...props} />)

    it('renders the title as plain text in the cards column, not a header band', () => {
      renderLoggedOut()

      // No `PageHeader`: that is the band with its own background, divider
      // and wider title row.
      expect(screen.queryByTestId('page-header')).not.toBeInTheDocument()
      const title = screen.getByRole('heading', {
        level: 1,
        name: 'Fediverse builders'
      })
      expect(title).toBeInTheDocument()
      // The heading and the subtitle share one wrapper that sits in the same
      // stack as the cards.
      const block = title.parentElement as HTMLElement
      expect(block.parentElement).toBe(
        screen.getByText('people I read').closest('section')?.parentElement
      )
      expect(within(block).getByText('by anna@llun.social')).toBeInTheDocument()
    })

    it('shows the empty state as an inset card below md, not the full-bleed surface', () => {
      renderLoggedOut({ statuses: [], totalCount: 0, publicRoster: [] })

      const card = screen
        .getByRole('heading', { name: 'No one in this collection yet' })
        .closest('div.rounded-xl') as HTMLElement
      expect(card).toHaveClass('rounded-xl', 'border', 'shadow-sm')
      expect(card.className).not.toContain('max-md:')
    })

    // `Posts` frames itself with the full-bleed feed surface; the class the
    // page passes is merged after it (see posts.test.tsx), so it has to carry
    // the shared inset card frame and take the viewport-wide margin back. The
    // real `Posts` is mocked here, so this pins what the page asks for.
    it('asks for the feed as an inset card below md, in the same column as the cards', () => {
      renderLoggedOut()

      const feed = screen.getByTestId('posts')
      expect(feed).toHaveClass(...MOBILE_INSET_FEED_CLASS.split(' '))
      expect(feed).toHaveClass(
        'max-md:mx-0',
        ...MOBILE_INSET_CARD_FRAME_CLASS.split(' ')
      )
      // Nothing of the viewport-wide surface comes back, and nothing is
      // unscoped: from md the feed keeps the frame `Posts` gives it.
      for (const token of MOBILE_FEED_SURFACE_CLASS.split(' ')) {
        expect(feed).not.toHaveClass(token)
      }
      feed.className
        .split(' ')
        .forEach((token) => expect(token).toMatch(/^max-md:/))
    })
  })

  it.each([
    { description: 'non-owner', isOwner: false },
    { description: 'owner', isOwner: true }
  ])(
    'leaves the signed-in $description feed to the full-bleed surface Posts applies',
    ({ isOwner }) => {
      render(
        <CollectionDetail
          {...baseProps}
          isOwner={isOwner}
          currentActor={{} as ActorProfile}
        />
      )

      expect(screen.getByTestId('posts')).not.toHaveAttribute('class')
    }
  )

  describe('signed-in visitor keeps the full-bleed empty state and inset byline', () => {
    it.each([
      { description: 'non-owner', isOwner: false },
      { description: 'owner', isOwner: true }
    ])('$description', ({ isOwner }) => {
      render(
        <CollectionDetail
          {...baseProps}
          isOwner={isOwner}
          currentActor={{} as ActorProfile}
          statuses={[]}
          totalCount={0}
          publicRoster={[]}
          ownerRoster={[]}
        />
      )

      const card = screen
        .getByRole('heading', { name: 'No one in this collection yet' })
        .closest('div.rounded-xl') as HTMLElement
      expect(card).toHaveClass(
        'max-md:mx-[calc(50%_-_50vw)]',
        'max-md:rounded-none',
        'max-md:border-0'
      )
      expect(screen.getByTestId('page-header')).toBeInTheDocument()
      if (!isOwner) {
        expect(screen.getByText(/Curated by/)).not.toHaveClass('max-md:px-0')
      }
    })
  })
})
