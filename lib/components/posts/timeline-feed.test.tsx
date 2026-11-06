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
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { likeStatus } from '@/lib/client'
import { resetBookmarkFolderStore } from '@/lib/components/bookmarks/bookmarkFolderStore'
import {
  BASE_TIME,
  createMockAnnounce,
  createMockNote,
  createMockPhoto,
  mockAlice,
  mockBob,
  mockCarol,
  multiAuthorConversationScenario,
  selfThreadScenario,
  singlePostScenario
} from '@/lib/components/posts/__fixtures__/timeline-context'
import { Status } from '@/lib/types/domain/status'
import { TimelineContext } from '@/lib/types/domain/timeline'
import { getStatusDetailPathClient } from '@/lib/utils/getStatusDetailPathClient'

import { preloadInlineStatusComposer } from './lazy-inline-status-composer'
import { TimelineFeed } from './timeline-feed'

const mockPush = vi.fn()

// Counts how often each row's <Post> renders, keyed by status id, by wrapping
// the real component.
const postRenders = vi.hoisted(() => new Map<string, number>())
vi.mock('./post', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./post')>()
  return {
    ...actual,
    Post: (props: React.ComponentProps<typeof actual.Post>) => {
      postRenders.set(
        props.status.id,
        (postRenders.get(props.status.id) ?? 0) + 1
      )
      return <actual.Post {...props} />
    }
  }
})

// Counts how often a combined row's post bodies render, keyed by status id.
const bodyRenders = vi.hoisted(() => new Map<string, number>())
vi.mock('./post-body', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./post-body')>()
  return {
    ...actual,
    PostBody: (props: React.ComponentProps<typeof actual.PostBody>) => {
      bodyRenders.set(
        props.status.id,
        (bodyRenders.get(props.status.id) ?? 0) + 1
      )
      return <actual.PostBody {...props} />
    }
  }
})

vi.mock('./collapsible-content', () => ({
  CollapsibleContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  )
}))

// A stable router, like Next's: a fresh object per render would defeat the
// memoized rows.
const mockRouter = { push: mockPush }
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter
}))

vi.mock('@/lib/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/client')>()
  return {
    ...actual,
    likeStatus: vi.fn(),
    undoLikeStatus: vi.fn(),
    getBookmarkFolders: vi
      .fn()
      .mockResolvedValue([
        { id: 'f-1', name: 'Saved', created_at: '', updated_at: '' }
      ]),
    setStatusBookmarkFolder: vi.fn().mockResolvedValue(true),
    getTranslationCapability: vi.fn().mockResolvedValue({ enabled: false }),
    getTranslationLanguages: vi.fn().mockResolvedValue([])
  }
})

vi.mock('@/lib/utils/getStatusDetailPathClient', () => ({
  getStatusDetailPathClient: vi.fn()
}))

vi.mock('./inline-status-composer', () => ({
  InlineStatusComposer: ({
    mode,
    status,
    onCancel,
    onReplyCreated
  }: {
    mode: string
    status: { id: string }
    onCancel?: () => void
    onReplyCreated?: (status: any) => void
  }) => (
    <div data-testid="inline-composer" data-mode={mode} data-status={status.id}>
      <button type="button" onClick={onCancel}>
        Cancel composer
      </button>
      <button
        type="button"
        data-testid="inline-composer-reply-btn"
        onClick={() =>
          onReplyCreated?.({
            id: `reply-to-${status.id}`,
            text: 'reply created'
          })
        }
      >
        Trigger Reply Created
      </button>
    </div>
  )
}))

// Only what the viewer is handed matters here, not the viewer itself.
vi.mock('@/lib/components/medias-modal/medias-modal', () => ({
  MediasModal: ({
    medias,
    albumsOwnerId
  }: {
    medias: unknown[] | null
    albumsOwnerId?: string | null
  }) =>
    medias ? (
      <div data-testid="viewer" data-albums-owner={albumsOwnerId ?? 'none'} />
    ) : null
}))

const mockGetStatusDetailPathClient = vi.mocked(getStatusDetailPathClient)
const mockLikeStatus = vi.mocked(likeStatus)

// Radix opens its menu via pointer events jsdom can't lay out, so drive it from
// the keyboard (as the post menu's own tests do).
const chooseFromMenu = async (trigger: HTMLElement, item: string) => {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('menuitem', { name: item }))
  // Some items run only once the menu has closed.
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
}
// The inline composer is loaded lazily; preload it so it renders synchronously.
beforeAll(async () => {
  await import('./inline-status-composer')
  preloadInlineStatusComposer()
  await new Promise((resolve) => setTimeout(resolve, 0))
})

describe('TimelineFeed', () => {
  beforeEach(() => {
    mockPush.mockClear()
    mockLikeStatus.mockReset()
    mockGetStatusDetailPathClient.mockResolvedValue('/@alice/test')
    // Each test loads the viewer's folders afresh.
    resetBookmarkFolderStore()
  })

  it('gives every row the feed-row class that skips off-screen rendering', () => {
    const { container } = render(
      <TimelineFeed
        host="activities.local"
        currentTime={BASE_TIME + 1000}
        statuses={selfThreadScenario.statuses}
      />
    )

    const articles = container.querySelectorAll('article')
    expect(articles.length).toBeGreaterThan(0)
    articles.forEach((article) => expect(article).toHaveClass('feed-row'))
  })

  it('renders a single status without thread or conversation wrapper', () => {
    render(
      <TimelineFeed
        host="activities.local"
        currentTime={BASE_TIME + 1000}
        statuses={singlePostScenario.statuses}
      />
    )

    expect(screen.queryByLabelText('Thread')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Conversation')).not.toBeInTheDocument()
    expect(
      screen.getByText('Just a solitary status update')
    ).toBeInTheDocument()
  })

  it('renders compact parent preview for standalone reply when parent is in timelineContext', () => {
    const parentId =
      'https://activities.local/users/bob/statuses/parent-thought'
    const replyPost = createMockNote({
      id: 'https://activities.local/users/alice/statuses/reply-to-bob',
      actor: mockAlice,
      createdAt: BASE_TIME + 2000,
      text: 'My reply to Bob',
      reply: parentId
    })

    const timelineContext: TimelineContext = {
      ancestorsById: {
        [parentId]: {
          id: parentId,
          url: 'https://activities.local/@bob/parent-thought',
          actor: {
            id: mockBob.id,
            username: mockBob.username,
            domain: mockBob.domain,
            name: mockBob.name
          },
          contentHtml: '<p>Bob original thought</p>',
          text: 'Bob original thought',
          createdAt: new Date(BASE_TIME).toISOString(),
          visibility: 'public'
        }
      }
    }

    render(
      <TimelineFeed
        host="activities.local"
        currentTime={BASE_TIME + 3000}
        statuses={[replyPost]}
        timelineContext={timelineContext}
      />
    )

    expect(screen.getByLabelText('Reply to @bob')).toBeInTheDocument()
    expect(screen.getByText('Bob Jones')).toBeInTheDocument()
    expect(screen.getByText(/Bob original thought/)).toBeInTheDocument()
  })

  it('renders generic reply indicator when standalone reply has no parent in timelineContext', () => {
    const replyPost = createMockNote({
      id: 'https://activities.local/users/alice/statuses/orphan',
      actor: mockAlice,
      createdAt: BASE_TIME + 2000,
      text: 'Orphan reply',
      reply: 'https://activities.local/users/ghost/statuses/missing'
    })

    render(
      <TimelineFeed
        host="activities.local"
        currentTime={BASE_TIME + 3000}
        statuses={[replyPost]}
      />
    )

    expect(screen.getByLabelText('In reply to a post')).toBeInTheDocument()
    expect(screen.getByText('In reply to a post')).toBeInTheDocument()
  })

  it('renders a self-thread <= 3 posts with Thread label in chronological order', () => {
    render(
      <TimelineFeed
        host="activities.local"
        currentTime={BASE_TIME + 200000}
        statuses={selfThreadScenario.statuses}
      />
    )

    const threadContainer = screen.getByLabelText('Thread')
    expect(threadContainer).toBeInTheDocument()

    // Chronological order: thread part 1 -> thread part 2 -> thread part 3
    const text1 = screen.getByText('Thread part 1: The introduction')
    const text2 = screen.getByText('Thread part 2: The continuation')
    const text3 = screen.getByText('Thread part 3: The conclusion')

    expect(text1).toBeInTheDocument()
    expect(text2).toBeInTheDocument()
    expect(text3).toBeInTheDocument()

    // Verify DOM order: text1 precedes text2 precedes text3
    expect(
      text1.compareDocumentPosition(text2) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      text2.compareDocumentPosition(text3) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('collapses middle posts in thread > 3 posts and expands on button click', () => {
    const t1 = createMockNote({
      id: 'https://activities.local/users/alice/statuses/long-t1',
      actor: mockAlice,
      createdAt: BASE_TIME,
      text: 'Post 1 of long thread',
      reply: ''
    })
    const t2 = createMockNote({
      id: 'https://activities.local/users/alice/statuses/long-t2',
      actor: mockAlice,
      createdAt: BASE_TIME + 1000,
      text: 'Post 2 of long thread',
      reply: t1.id
    })
    const t3 = createMockNote({
      id: 'https://activities.local/users/alice/statuses/long-t3',
      actor: mockAlice,
      createdAt: BASE_TIME + 2000,
      text: 'Post 3 of long thread',
      reply: t2.id
    })
    const t4 = createMockNote({
      id: 'https://activities.local/users/alice/statuses/long-t4',
      actor: mockAlice,
      createdAt: BASE_TIME + 3000,
      text: 'Post 4 of long thread',
      reply: t3.id
    })
    const t5 = createMockNote({
      id: 'https://activities.local/users/alice/statuses/long-t5',
      actor: mockAlice,
      createdAt: BASE_TIME + 4000,
      text: 'Post 5 of long thread',
      reply: t4.id
    })

    const rawFeed: Status[] = [t5, t4, t3, t2, t1]

    render(
      <TimelineFeed
        host="activities.local"
        currentTime={BASE_TIME + 10000}
        statuses={rawFeed}
      />
    )

    expect(screen.getByLabelText('Thread')).toBeInTheDocument()

    // Post 1 and Post 5 should be visible
    expect(screen.getByText('Post 1 of long thread')).toBeInTheDocument()
    expect(screen.getByText('Post 5 of long thread')).toBeInTheDocument()

    // Middle posts (t2, t3, t4) should NOT be visible initially
    expect(screen.queryByText('Post 2 of long thread')).not.toBeInTheDocument()
    expect(screen.queryByText('Post 3 of long thread')).not.toBeInTheDocument()
    expect(screen.queryByText('Post 4 of long thread')).not.toBeInTheDocument()

    // Expander button should be visible with "Show 3 earlier posts in thread"
    const expandButton = screen.getByRole('button', {
      name: /Show 3 earlier posts in thread/i
    })
    expect(expandButton).toBeInTheDocument()
    expect(expandButton).toHaveAttribute('aria-expanded', 'false')

    // Click to expand
    fireEvent.click(expandButton)

    // Now all 5 posts must be visible
    expect(screen.getByText('Post 1 of long thread')).toBeInTheDocument()
    expect(screen.getByText('Post 2 of long thread')).toBeInTheDocument()
    expect(screen.getByText('Post 3 of long thread')).toBeInTheDocument()
    expect(screen.getByText('Post 4 of long thread')).toBeInTheDocument()
    expect(screen.getByText('Post 5 of long thread')).toBeInTheDocument()

    // The expander button is gone
    expect(
      screen.queryByRole('button', { name: /Show 3 earlier posts in thread/i })
    ).not.toBeInTheDocument()
  })

  describe('combined self-replies', () => {
    const MINUTE = 60 * 1000
    const note = (name: string, at: number, reply: string, actor = mockAlice) =>
      createMockNote({
        id: `https://activities.local/users/${actor.username}/statuses/${name}`,
        actor,
        createdAt: BASE_TIME + at,
        text: `Text of ${name}`,
        reply
      })
    const actionBars = () =>
      screen.queryAllByRole('group', { name: 'Post actions' })

    it('keeps the collapsed long thread as it was and combines it once expanded', () => {
      const t1 = note('c1', 0, '')
      const t2 = note('c2', MINUTE, t1.id)
      const t3 = note('c3', 2 * MINUTE, t2.id)
      const t4 = note('c4', 3 * MINUTE, t3.id)

      render(
        <TimelineFeed
          host="activities.local"
          currentTime={BASE_TIME + 10 * MINUTE}
          statuses={[t4, t3, t2, t1]}
          currentActor={mockBob}
          showActions
        />
      )

      // Collapsed: first post, expander, last post, each a post of its own.
      expect(screen.getByText('Text of c1')).toBeInTheDocument()
      expect(screen.getByText('Text of c4')).toBeInTheDocument()
      expect(screen.queryByText('Text of c2')).not.toBeInTheDocument()
      expect(screen.queryByText(/\d of 4/)).not.toBeInTheDocument()
      expect(actionBars()).toHaveLength(2)

      fireEvent.click(
        screen.getByRole('button', { name: /Show 2 earlier posts in thread/i })
      )

      // Expanded: one combined post with one action bar and numbered parts.
      expect(actionBars()).toHaveLength(1)
      for (const name of ['c1', 'c2', 'c3', 'c4']) {
        expect(screen.getByText(`Text of ${name}`)).toBeInTheDocument()
      }
      expect(
        screen.getByRole('button', { name: /Open part 2 of 4/ })
      ).toHaveTextContent('2 of 4 · 9m')
      expect(
        screen.getByRole('button', { name: /Open part 4 of 4/ })
      ).toHaveTextContent('4 of 4 · 7m')
      expect(screen.queryByText(/1 of 4/)).not.toBeInTheDocument()
    })

    it('combines a thread of up to three posts straight away', () => {
      render(
        <TimelineFeed
          host="activities.local"
          currentTime={BASE_TIME + 200000}
          statuses={selfThreadScenario.statuses}
          currentActor={mockBob}
          showActions
        />
      )

      expect(screen.getByLabelText('Thread')).toBeInTheDocument()
      expect(actionBars()).toHaveLength(1)
      expect(screen.getAllByRole('article')).toHaveLength(1)
      expect(
        screen.getByRole('button', { name: /Open part 2 of 3/ })
      ).toHaveTextContent('2 of 3 · 2m')
      // The header shows the span from the first post to the last.
      expect(
        screen.getByRole('button', { name: /Open status by Alice Smith/ })
      ).toHaveTextContent('3m – 1m')
      for (const text of [
        'Thread part 1: The introduction',
        'Thread part 2: The continuation',
        'Thread part 3: The conclusion'
      ]) {
        expect(screen.getByText(text)).toBeInTheDocument()
      }
    })

    it('opens the detail page of the part whose label is clicked', async () => {
      mockGetStatusDetailPathClient.mockResolvedValue('/@alice/thread-2')
      render(
        <TimelineFeed
          host="activities.local"
          currentTime={BASE_TIME + 200000}
          statuses={selfThreadScenario.statuses}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /Open part 2 of 3/ }))

      await waitFor(() =>
        expect(mockPush).toHaveBeenCalledWith('/@alice/thread-2')
      )
      expect(mockGetStatusDetailPathClient).toHaveBeenCalledWith(
        selfThreadScenario.reply1
      )
    })

    it('combines posts hours apart into one card', () => {
      const t1 = note('g1', 0, '')
      const t2 = note('g2', 12 * 60 * MINUTE, t1.id)

      render(
        <TimelineFeed
          host="activities.local"
          currentTime={BASE_TIME + 13 * 60 * MINUTE}
          statuses={[t2, t1]}
          currentActor={mockBob}
          showActions
        />
      )

      expect(actionBars()).toHaveLength(1)
      expect(screen.getByText(/2 of 2/)).toBeInTheDocument()
    })

    it('shows the row as separate posts again from the menu', async () => {
      render(
        <TimelineFeed
          host="activities.local"
          currentTime={BASE_TIME + 200000}
          statuses={selfThreadScenario.statuses}
          currentActor={mockBob}
          showActions
        />
      )
      expect(actionBars()).toHaveLength(1)

      await chooseFromMenu(
        screen.getByRole('button', {
          name: 'More actions for this post group'
        }),
        'Show as separate posts'
      )

      await waitFor(() => expect(actionBars()).toHaveLength(3))
      expect(screen.queryByText(/\d of 3/)).not.toBeInTheDocument()
      expect(
        screen.getByText('Thread part 2: The continuation')
      ).toBeInTheDocument()
      // Focus moves to the row instead of falling to <body>.
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByLabelText('Thread'))
      )
    })

    it('replies to the latest post and acts on the first one', async () => {
      mockLikeStatus.mockResolvedValue(true)
      const onLikeChanged = vi.fn()

      render(
        <TimelineFeed
          host="activities.local"
          currentTime={BASE_TIME + 200000}
          statuses={selfThreadScenario.statuses}
          currentActor={mockBob}
          showActions
          onLikeChanged={onLikeChanged}
        />
      )

      fireEvent.click(
        screen.getByRole('button', { name: 'Reply to the latest post' })
      )
      const composer = screen.getByTestId('inline-composer')
      expect(composer).toHaveAttribute('data-mode', 'reply')
      expect(composer).toHaveAttribute(
        'data-status',
        selfThreadScenario.reply2.id
      )
      // Under the combined post, not somewhere else in the feed.
      expect(screen.getByRole('article')).toContainElement(composer)

      fireEvent.click(
        screen.getByRole('button', { name: 'Like the first post' })
      )
      await waitFor(() =>
        expect(onLikeChanged).toHaveBeenCalledWith(
          expect.objectContaining({ id: selfThreadScenario.root.id }),
          true
        )
      )
      expect(mockLikeStatus).toHaveBeenCalledWith({
        statusId: selfThreadScenario.root.id
      })
      for (const name of [
        'Repost the first post',
        'Bookmark the first post',
        'Add reaction to the first post',
        'More actions for this post group'
      ]) {
        expect(screen.getByRole('button', { name })).toBeInTheDocument()
      }
    })

    it('gives each later part its own Like that acts on that part', async () => {
      const onLikeChanged = vi.fn()
      const { rerender } = render(
        <TimelineFeed
          host="activities.local"
          currentTime={BASE_TIME + 200000}
          statuses={selfThreadScenario.statuses}
          currentActor={mockBob}
          showActions
          onLikeChanged={onLikeChanged}
        />
      )

      expect(
        screen.queryByRole('button', { name: /^Like part 1 of 3/ })
      ).toBeNull()
      expect(
        screen.getByRole('button', { name: /^Like part 3 of 3/ })
      ).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /^Like part 2 of 3/ }))
      await waitFor(() =>
        expect(onLikeChanged).toHaveBeenCalledWith(
          expect.objectContaining({ id: selfThreadScenario.reply1.id }),
          true
        )
      )
      expect(mockLikeStatus).toHaveBeenLastCalledWith({
        statusId: selfThreadScenario.reply1.id
      })

      rerender(
        <TimelineFeed
          host="activities.local"
          currentTime={BASE_TIME + 200000}
          statuses={selfThreadScenario.statuses}
        />
      )
      expect(screen.queryByRole('button', { name: /^Like part/ })).toBeNull()
    })

    it('offers every part its own menu, own or not', async () => {
      const { rerender } = render(
        <TimelineFeed
          host="activities.local"
          currentTime={BASE_TIME + 200000}
          statuses={selfThreadScenario.statuses}
          currentActor={mockAlice}
          showActions
        />
      )

      expect(
        screen.getByRole('button', { name: 'More actions for part 2 of 3' })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'More actions for part 3 of 3' })
      ).toBeInTheDocument()

      rerender(
        <TimelineFeed
          host="activities.local"
          currentTime={BASE_TIME + 200000}
          statuses={selfThreadScenario.statuses}
          currentActor={mockBob}
          showActions
        />
      )
      // Another author's parts keep a menu too (quote, copy link, report, …).
      const partMenu = screen.getByRole('button', {
        name: 'More actions for part 2 of 3'
      })
      expect(
        screen.getByRole('button', { name: 'More actions for part 3 of 3' })
      ).toBeInTheDocument()
      fireEvent.keyDown(partMenu, { key: 'ArrowDown' })
      expect(
        await screen.findByRole('menuitem', { name: /Copy link/ })
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('menuitem', { name: 'Edit post' })
      ).not.toBeInTheDocument()
    })

    it('files a later part from its own ⋯ menu', async () => {
      const onBookmarkChanged = vi.fn()
      render(
        <TimelineFeed
          host="activities.local"
          currentTime={BASE_TIME + 200000}
          statuses={selfThreadScenario.statuses}
          currentActor={mockBob}
          showActions
          onBookmarkChanged={onBookmarkChanged}
        />
      )

      fireEvent.keyDown(
        screen.getByRole('button', { name: 'More actions for part 2 of 3' }),
        { key: 'ArrowDown' }
      )
      const menu = await screen.findByRole('menu')
      fireEvent.keyDown(
        within(menu).getByRole('menuitem', { name: 'Bookmark folder' }),
        { key: 'ArrowRight' }
      )
      const folderItem = await screen.findByRole('menuitemradio', {
        name: 'Saved'
      })
      await act(async () => {
        fireEvent.click(folderItem)
      })

      expect(onBookmarkChanged).toHaveBeenCalledWith(
        expect.objectContaining({ id: selfThreadScenario.reply1.id }),
        true,
        'f-1'
      )
    })

    it('says in the group menu that post items act on the first post', async () => {
      render(
        <TimelineFeed
          host="activities.local"
          currentTime={BASE_TIME + 200000}
          statuses={selfThreadScenario.statuses}
          currentActor={mockBob}
          showActions
        />
      )

      fireEvent.keyDown(
        screen.getByRole('button', {
          name: 'More actions for this post group'
        }),
        { key: 'ArrowDown' }
      )
      expect(await screen.findByText('Post group')).toBeInTheDocument()
      expect(screen.getByText('First post')).toBeInTheDocument()
      const groupSection = screen.getByRole('group', { name: 'Post group' })
      const firstPostSection = screen.getByRole('group', {
        name: 'First post'
      })
      const groupNames = within(groupSection)
        .getAllByRole('menuitem')
        .map((item) => item.textContent)
      const firstPostNames = within(firstPostSection)
        .getAllByRole('menuitem')
        .map((item) => item.textContent)
      expect(groupNames).toEqual(
        expect.arrayContaining(['Show as separate posts'])
      )
      expect(firstPostNames.join('|')).toMatch(/Copy link/)
      expect(firstPostNames).not.toContain('Show as separate posts')
      expect(groupNames.join('|')).not.toMatch(/Copy link/)
      expect(firstPostNames).not.toContain('Show as separate posts')
      expect(
        screen.getByRole('menuitem', { name: 'Show as separate posts' })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('menuitem', { name: /Copy link/ })
      ).toBeInTheDocument()
    })

    it('combines a run that starts with a reply to someone else', () => {
      const b0 = note('r0', 0, '', mockBob)
      const a1 = note('r1', MINUTE, b0.id)
      const a2 = note('r2', 2 * MINUTE, a1.id)
      const a3 = note('r3', 3 * MINUTE, a2.id)

      render(
        <TimelineFeed
          host="activities.local"
          currentTime={BASE_TIME + 10 * MINUTE}
          statuses={[a3, a2, a1, b0]}
          currentActor={mockBob}
          showActions
        />
      )

      expect(screen.getByLabelText('Conversation')).toBeInTheDocument()
      // Bob's post on its own, then Alice's three replies as one post.
      expect(actionBars()).toHaveLength(2)
      expect(screen.getAllByRole('article')).toHaveLength(2)
      expect(
        screen.getByRole('button', { name: /Open part 2 of 3/ })
      ).toBeInTheDocument()
      expect(screen.queryByText(/1 of 3/)).not.toBeInTheDocument()
      expect(screen.getByText('Text of r0')).toBeInTheDocument()
    })

    it('keeps the row as separate posts after a reply is added to it', async () => {
      const t1 = note('s1', 0, '')
      const t2 = note('s2', MINUTE, t1.id)
      const t3 = note('s3', 2 * MINUTE, t2.id)
      const renderFeed = (statuses: Status[]) => (
        <TimelineFeed
          host="activities.local"
          currentTime={BASE_TIME + 10 * MINUTE}
          statuses={statuses}
          currentActor={mockBob}
          showActions
        />
      )
      const { rerender } = render(renderFeed([t3, t2, t1]))
      expect(actionBars()).toHaveLength(1)

      await chooseFromMenu(
        screen.getByRole('button', {
          name: 'More actions for this post group'
        }),
        'Show as separate posts'
      )
      await waitFor(() => expect(actionBars()).toHaveLength(3))

      // A reply arrives (inline reply, paging): the row's key changes, the
      // viewer's choice does not.
      const t4 = note('s4', 3 * MINUTE, t3.id)
      rerender(renderFeed([t4, t3, t2, t1]))

      // The row was showing all three posts, so the fourth does not fold the
      // others away behind the expander.
      expect(screen.getByText('Text of s4')).toBeInTheDocument()
      expect(actionBars()).toHaveLength(4)
      expect(screen.queryByText(/\d of \d/)).not.toBeInTheDocument()
    })

    it('keeps the row as separate posts after its root post goes away', async () => {
      const t1 = note('r1', 0, '')
      const t2 = note('r2', MINUTE, t1.id)
      const t3 = note('r3', 2 * MINUTE, t2.id)
      const renderFeed = (statuses: Status[]) => (
        <TimelineFeed
          host="activities.local"
          currentTime={BASE_TIME + 10 * MINUTE}
          statuses={statuses}
          currentActor={mockBob}
          showActions
        />
      )
      const { rerender } = render(renderFeed([t3, t2, t1]))
      await chooseFromMenu(
        screen.getByRole('button', {
          name: 'More actions for this post group'
        }),
        'Show as separate posts'
      )
      await waitFor(() => expect(actionBars()).toHaveLength(3))

      // The root is deleted: the row now starts at r2 and stays separate.
      rerender(renderFeed([t3, t2]))
      expect(actionBars()).toHaveLength(2)
      expect(screen.queryByText(/\d of \d/)).not.toBeInTheDocument()
    })

    it('keeps the composer when a collapsed thread is expanded into one post', () => {
      const t1 = note('x1', 0, '')
      const t2 = note('x2', MINUTE, t1.id)
      const t3 = note('x3', 2 * MINUTE, t2.id)
      const t4 = note('x4', 3 * MINUTE, t3.id)

      render(
        <TimelineFeed
          host="activities.local"
          currentTime={BASE_TIME + 10 * MINUTE}
          statuses={[t4, t3, t2, t1]}
          currentActor={mockBob}
          showActions
        />
      )

      // Reply on the last post, which is visible in the collapsed thread.
      const [, lastReply] = screen.getAllByRole('button', { name: /^Reply to/ })
      fireEvent.click(lastReply)
      expect(screen.getByTestId('inline-composer')).toHaveAttribute(
        'data-status',
        t4.id
      )

      fireEvent.click(
        screen.getByRole('button', { name: /Show 2 earlier posts in thread/i })
      )

      expect(actionBars()).toHaveLength(1)
      expect(screen.getAllByTestId('inline-composer')).toHaveLength(1)
      expect(screen.getByRole('article')).toContainElement(
        screen.getByTestId('inline-composer')
      )
    })

    it('anchors the reply composer to the latest part, so it stays under it after the row is split', async () => {
      const t1 = note('z1', 0, '')
      const t2 = note('z2', MINUTE, t1.id)
      const t3 = note('z3', 2 * MINUTE, t2.id)

      render(
        <TimelineFeed
          host="activities.local"
          currentTime={BASE_TIME + 10 * MINUTE}
          statuses={[t3, t2, t1]}
          currentActor={mockBob}
          showActions
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /^Reply to/ }))
      expect(screen.getByTestId('inline-composer')).toHaveAttribute(
        'data-status',
        t3.id
      )

      await chooseFromMenu(
        screen.getByRole('button', {
          name: 'More actions for this post group'
        }),
        'Show as separate posts'
      )
      await waitFor(() => expect(actionBars()).toHaveLength(3))

      const articles = screen.getAllByRole('article')
      expect(articles).toHaveLength(3)
      const composer = screen.getByTestId('inline-composer')
      expect(articles[2]).toContainElement(composer)
      expect(articles[0]).not.toContainElement(composer)
    })

    describe('edit history of later parts', () => {
      const edited = (name: string, at: number, reply: string) =>
        createMockNote({
          id: `https://activities.local/users/alice/statuses/${name}`,
          actor: mockAlice,
          createdAt: BASE_TIME + at,
          text: `Text of ${name}`,
          reply,
          edits: [
            { text: `Old text of ${name}`, createdAt: BASE_TIME + at - 1000 }
          ]
        })

      it('shows the edit history of a part that was edited', () => {
        const e1 = note('e1', 0, '')
        const e2 = edited('e2', MINUTE, e1.id)
        const e3 = note('e3', 2 * MINUTE, e2.id)

        render(
          <TimelineFeed
            host="activities.local"
            currentTime={BASE_TIME + 10 * MINUTE}
            statuses={[e3, e2, e1]}
            currentActor={mockBob}
            showActions
          />
        )

        // Only the edited part has one, and the first post's bar has none.
        const button = screen.getByRole('button', {
          name: 'Show edit history of part 2 of 3, 1 edit'
        })
        expect(
          screen.getAllByRole('button', { name: /Show edit history/ })
        ).toHaveLength(1)

        fireEvent.click(button)
        const panel = screen.getByRole('region', { name: 'Edit history' })
        expect(panel).toHaveTextContent('Old text of e2')
        expect(panel).toHaveAttribute('data-row-overlay')
      })

      it('names the first post on the bar’s own edit history button', () => {
        const f1 = edited('f1', 0, '')
        const f2 = edited('f2', MINUTE, f1.id)

        render(
          <TimelineFeed
            host="activities.local"
            currentTime={BASE_TIME + 10 * MINUTE}
            statuses={[f2, f1]}
            currentActor={mockBob}
            showActions
          />
        )

        expect(
          screen.getByRole('button', {
            name: 'Show edit history of the first post, 1 edit'
          })
        ).toBeInTheDocument()
        expect(
          screen.getByRole('button', {
            name: 'Show edit history of part 2 of 2, 1 edit'
          })
        ).toBeInTheDocument()
      })
    })

    it('leaves a conversation without self-replies as separate posts', () => {
      render(
        <TimelineFeed
          host="activities.local"
          currentTime={BASE_TIME + 200000}
          statuses={multiAuthorConversationScenario.statuses}
          currentActor={mockAlice}
          showActions
        />
      )

      expect(screen.getByLabelText('Conversation')).toBeInTheDocument()
      expect(actionBars()).toHaveLength(3)
    })

    it('tucks someone else’s reply into a combined conversation', async () => {
      const a1 = note('v1', 0, '')
      const b1 = note('v2', MINUTE, a1.id, mockBob)
      const a2 = note('v3', 2 * MINUTE, a1.id)

      render(
        <TimelineFeed
          host="activities.local"
          currentTime={BASE_TIME + 10 * MINUTE}
          statuses={[a2, b1, a1]}
          currentActor={mockAlice}
          showActions
        />
      )

      expect(screen.getByLabelText('Conversation')).toBeInTheDocument()
      expect(actionBars()).toHaveLength(1)
      const inset = screen.getByRole('group', { name: 'Reply by Bob Jones' })
      expect(inset).toHaveTextContent('Text of v2')
      // The inset carries just reply and like on its face.
      expect(
        within(inset).getByRole('button', {
          name: /Reply to Bob Jones’s reply|Reply to Bob Jones's reply/
        })
      ).toBeInTheDocument()
      expect(
        within(inset).getByRole('button', { name: /Like Bob Jones's reply/ })
      ).toBeInTheDocument()
      expect(within(inset).queryByRole('button', { name: /Repost/ })).toBeNull()
      expect(
        screen.getByRole('button', { name: /Open part 2 of 2/ })
      ).toBeInTheDocument()
      // Everything else is in the card's own ⋯ menu.
      fireEvent.keyDown(
        within(inset).getByRole('button', {
          name: /More actions for Bob Jones's reply/
        }),
        { key: 'ArrowDown' }
      )
      expect(
        await screen.findByRole('menuitem', { name: /Copy link/ })
      ).toBeInTheDocument()
    })

    it('reports a filing from the tucked-in reply’s own ⋯ menu', async () => {
      const a1 = note('w1', 0, '')
      const b1 = note('w2', MINUTE, a1.id, mockBob)
      const a2 = note('w3', 2 * MINUTE, a1.id)
      const onBookmarkChanged = vi.fn()

      render(
        <TimelineFeed
          host="activities.local"
          currentTime={BASE_TIME + 10 * MINUTE}
          statuses={[a2, b1, a1]}
          currentActor={mockAlice}
          showActions
          onBookmarkChanged={onBookmarkChanged}
        />
      )

      const inset = screen.getByRole('group', { name: 'Reply by Bob Jones' })
      fireEvent.keyDown(
        within(inset).getByRole('button', {
          name: /More actions for Bob Jones's reply/
        }),
        { key: 'ArrowDown' }
      )
      const menu = await screen.findByRole('menu')
      fireEvent.keyDown(
        within(menu).getByRole('menuitem', { name: 'Bookmark folder' }),
        { key: 'ArrowRight' }
      )
      const folderItem = await screen.findByRole('menuitemradio', {
        name: 'Saved'
      })
      await act(async () => {
        fireEvent.click(folderItem)
      })

      expect(onBookmarkChanged).toHaveBeenCalledWith(
        expect.objectContaining({ id: b1.id }),
        true,
        'f-1'
      )
    })

    describe('stable rows', () => {
      const feed = (statuses: Status[], extra = {}) => (
        <TimelineFeed
          host="activities.local"
          currentTime={BASE_TIME + 30 * MINUTE}
          statuses={statuses}
          currentActor={mockBob}
          showActions
          {...extra}
        />
      )

      it('keeps an expanded long thread expanded when a reply arrives', () => {
        const t1 = note('e1', 0, '')
        const t2 = note('e2', MINUTE, t1.id)
        const t3 = note('e3', 2 * MINUTE, t2.id)
        const t4 = note('e4', 3 * MINUTE, t3.id)
        const { rerender } = render(feed([t4, t3, t2, t1]))
        fireEvent.click(
          screen.getByRole('button', { name: /Show 2 earlier posts/i })
        )
        expect(actionBars()).toHaveLength(1)

        const t5 = note('e5', 4 * MINUTE, t4.id)
        rerender(feed([t5, t4, t3, t2, t1]))

        expect(
          screen.queryByRole('button', { name: /earlier posts in thread/i })
        ).toBeNull()
        expect(actionBars()).toHaveLength(1)
        expect(screen.getByText('Text of e5')).toBeInTheDocument()
      })

      it('keeps a three-post combined card combined when a fourth part arrives', () => {
        const t1 = note('g1', 0, '')
        const t2 = note('g2', MINUTE, t1.id)
        const t3 = note('g3', 2 * MINUTE, t2.id)
        const { rerender } = render(feed([t3, t2, t1]))
        expect(screen.getByText(/2 of 3/)).toBeInTheDocument()

        const t4 = note('g4', 3 * MINUTE, t3.id)
        rerender(feed([t4, t3, t2, t1]))

        expect(
          screen.queryByRole('button', { name: /earlier posts in thread/i })
        ).toBeNull()
        expect(screen.getByText(/4 of 4/)).toBeInTheDocument()
      })

      it('does not remount a row when a part is added to it', () => {
        const t1 = note('k1', 0, '')
        const t2 = note('k2', MINUTE, t1.id)
        const { rerender } = render(feed([t2, t1]))
        const before = document.querySelector('[data-row-status-ids]')

        const t3 = note('k3', 2 * MINUTE, t2.id)
        rerender(feed([t3, t2, t1]))

        expect(document.querySelector('[data-row-status-ids]')).toBe(before)
      })
    })

    describe('posts split off a run', () => {
      it('shows a reply preview built from the loaded parent on posts split off a run', () => {
        const a1 = note('p1', 0, '')
        const a2 = note('p2', MINUTE, a1.id)
        const b1 = note('p3', 2 * MINUTE, a1.id, mockBob)
        const c1 = note('p4', 3 * MINUTE, a2.id, mockCarol)

        render(
          <TimelineFeed
            host="activities.local"
            currentTime={BASE_TIME + 10 * MINUTE}
            statuses={[c1, b1, a2, a1]}
            currentActor={mockAlice}
            showActions
          />
        )

        // One combined card, then Bob's and Carol's replies as plain posts;
        // neither answers the post right above it, so each names its parent.
        expect(screen.getByText(/2 of 2/)).toBeInTheDocument()
        expect(screen.getByText('Text of p3')).toBeInTheDocument()
        expect(screen.getByText('Text of p4')).toBeInTheDocument()
        expect(screen.queryByLabelText('In reply to a post')).toBeNull()
        expect(screen.getAllByLabelText('Reply to @alice')).toHaveLength(2)
      })

      it('shows no reply context on a post that answers the post right above it', () => {
        const a1 = note('q1', 0, '')
        const a2 = note('q2', MINUTE, a1.id)
        const b1 = note('q3', 2 * MINUTE, a2.id, mockBob)

        render(
          <TimelineFeed
            host="activities.local"
            currentTime={BASE_TIME + 10 * MINUTE}
            statuses={[b1, a2, a1]}
            currentActor={mockAlice}
            showActions
          />
        )

        expect(
          screen.queryByLabelText(/Reply to @|In reply to a post/)
        ).toBeNull()
      })
    })

    it('collapses a thread that gains older parts instead of keeping it in full', () => {
      const parts: Status[] = []
      for (let i = 0; i < 8; i++) {
        parts.push(note(`o${i}`, i * MINUTE, i === 0 ? '' : parts[i - 1].id))
      }
      const feed = (statuses: Status[]) => (
        <TimelineFeed
          host="activities.local"
          currentTime={BASE_TIME + 30 * MINUTE}
          statuses={statuses}
          currentActor={mockBob}
          showActions
        />
      )
      const { rerender } = render(feed(parts.slice(5).reverse()))
      expect(screen.getByText(/2 of 3/)).toBeInTheDocument()

      // Five older parts load in, so the row has a new root.
      rerender(feed([...parts].reverse()))
      expect(
        screen.getByRole('button', { name: /earlier posts in thread/i })
      ).toBeInTheDocument()
    })

    it('names the parent of later posts when a conversation no longer forms a run', () => {
      const a1 = note('w1', 0, '')
      const b1 = note('w2', MINUTE, a1.id, mockBob)
      const c1 = note('w3', 2 * MINUTE, a1.id, mockCarol)
      const a2 = note('w4', 3 * MINUTE, b1.id)

      render(
        <TimelineFeed
          host="activities.local"
          currentTime={BASE_TIME + 10 * MINUTE}
          statuses={[a2, c1, b1, a1]}
          currentActor={mockAlice}
          showActions
        />
      )

      expect(screen.queryByText(/\d of \d/)).not.toBeInTheDocument()
      // b1 answers the post directly above it, c1 and a2 do not.
      expect(screen.queryByLabelText('In reply to a post')).toBeNull()
      expect(screen.getAllByLabelText(/^Reply to @/)).toHaveLength(2)
      expect(screen.getByLabelText('Reply to @bob')).toBeInTheDocument()
    })

    it('names the combined card for assistive technology', () => {
      render(
        <TimelineFeed
          host="activities.local"
          currentTime={BASE_TIME + 200000}
          statuses={selfThreadScenario.statuses}
          currentActor={mockBob}
          showActions
        />
      )

      expect(
        screen.getByRole('article', { name: 'Thread by Alice Smith, 3 posts' })
      ).toBeInTheDocument()
    })
  })

  describe('first visible media', () => {
    const MINUTE = 60 * 1000
    const note = (
      name: string,
      at: number,
      { reply = '', photo = false }: { reply?: string; photo?: boolean } = {}
    ) => {
      const status = createMockNote({
        id: `https://activities.local/users/alice/statuses/${name}`,
        createdAt: BASE_TIME + at * MINUTE,
        text: `Text of ${name}`,
        reply
      })
      return photo
        ? {
            ...status,
            attachments: [
              {
                ...createMockPhoto(status, name),
                blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj'
              }
            ]
          }
        : status
    }
    // A prioritized image is revealed at once (no hydration fade).
    const prioritizedImages = (container: HTMLElement) =>
      [...container.querySelectorAll('img.opacity-100')].map((img) =>
        img.getAttribute('src')
      )
    const renderFeed = (statuses: Status[], prioritizeFirstMedia = true) =>
      render(
        <TimelineFeed
          host="activities.local"
          currentTime={BASE_TIME + 10 * MINUTE}
          statuses={statuses}
          prioritizeFirstMedia={prioritizeFirstMedia}
        />
      )

    it('keeps every image lazy unless the feed opts in', () => {
      const { container } = renderFeed([note('p1', 1, { photo: true })], false)
      expect(container.querySelector('img')).not.toBeNull()
      expect(prioritizedImages(container)).toEqual([])
    })

    it('picks the picture at the top of the rendered feed, inside a combined card', () => {
      const top = note('top', 1, { photo: true })
      const middle = note('middle', 2, { photo: true })
      const self = note('self', 3, { reply: top.id })

      // Newest first, `self` leads the list, but its card renders `top` first.
      const { container } = renderFeed([self, middle, top])

      expect(
        screen.getByRole('button', { name: /Open part 2 of 2/ })
      ).toBeInTheDocument()
      expect(prioritizedImages(container)).toEqual([
        expect.stringContaining('top.jpg')
      ])
    })

    it("gives a combined card's first part with a picture the priority", () => {
      const top = note('top', 1)
      const middle = note('middle', 2, { photo: true })
      const self = note('self', 3, { reply: top.id, photo: true })

      const { container } = renderFeed([self, middle, top])

      // Part 2 of the leading card is above the next row's picture.
      expect(prioritizedImages(container)).toEqual([
        expect.stringContaining('self.jpg')
      ])
    })

    it('looks only at the first three rendered rows', () => {
      const { container } = renderFeed([
        note('t1', 4),
        note('t2', 3),
        note('t3', 2),
        note('late', 1, { photo: true })
      ])
      expect(prioritizedImages(container)).toEqual([])
    })
  })

  it('renders a multi-author conversation with Conversation label', () => {
    render(
      <TimelineFeed
        host="activities.local"
        currentTime={BASE_TIME + 200000}
        statuses={multiAuthorConversationScenario.statuses}
      />
    )

    const convContainer = screen.getByLabelText('Conversation')
    expect(convContainer).toBeInTheDocument()

    expect(
      screen.getByText(/Alice: What does everyone think of Phanpy/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/It groups conversations nicely!/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Agreed, the nested replies make reading easier/)
    ).toBeInTheDocument()
  })

  it('targets the correct status when replying from a separate thread post', async () => {
    render(
      <TimelineFeed
        host="activities.local"
        currentTime={BASE_TIME + 200000}
        statuses={selfThreadScenario.statuses}
        currentActor={mockAlice}
        showActions={true}
      />
    )

    // Initially no composer is open
    expect(screen.queryByTestId('inline-composer')).not.toBeInTheDocument()

    await chooseFromMenu(
      screen.getByRole('button', { name: 'More actions for this post group' }),
      'Show as separate posts'
    )

    // Click reply on the second post
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: /reply/i }).length
      ).toBeGreaterThanOrEqual(3)
    )
    const replyButtons = screen.getAllByRole('button', { name: /reply/i })
    expect(replyButtons.length).toBeGreaterThanOrEqual(3)

    // Click reply on post 2
    fireEvent.click(replyButtons[1])

    const composer = await screen.findByTestId('inline-composer')
    expect(composer).toBeInTheDocument()
    expect(composer).toHaveAttribute('data-mode', 'reply')
    expect(composer).toHaveAttribute(
      'data-status',
      selfThreadScenario.reply1.id
    )
  })

  it('triggers onLikeChanged with correct status when liked', async () => {
    mockLikeStatus.mockResolvedValue(true)
    const onLikeChanged = vi.fn()

    render(
      <TimelineFeed
        host="activities.local"
        currentTime={BASE_TIME + 200000}
        statuses={selfThreadScenario.statuses}
        currentActor={mockBob}
        showActions={true}
        onLikeChanged={onLikeChanged}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Like the first post' }))
    await waitFor(() => {
      expect(onLikeChanged).toHaveBeenCalledWith(
        expect.objectContaining({ id: selfThreadScenario.root.id }),
        true
      )
    })
  })

  it('forwards onReplyCreated callback to InlineStatusComposer', () => {
    const onReplyCreated = vi.fn()
    render(
      <TimelineFeed
        host="activities.local"
        currentTime={BASE_TIME + 200000}
        statuses={singlePostScenario.statuses}
        currentActor={mockAlice}
        showActions={true}
        onReplyCreated={onReplyCreated}
      />
    )

    // Open reply composer
    const replyButton = screen.getByRole('button', { name: /reply/i })
    fireEvent.click(replyButton)

    // The composer is rendered
    expect(screen.getByTestId('inline-composer')).toBeInTheDocument()

    // Trigger onReplyCreated from the composer
    fireEvent.click(screen.getByTestId('inline-composer-reply-btn'))

    expect(onReplyCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `reply-to-${singlePostScenario.statuses[0].id}`,
        text: 'reply created'
      })
    )
  })

  it('renders boosts as individual timeline post rows by default in sequence', () => {
    const post1 = createMockNote({
      id: 'https://activities.local/users/alice/statuses/p1',
      actor: mockAlice,
      createdAt: BASE_TIME,
      text: 'First post by Alice'
    })
    const target2 = createMockNote({
      id: 'https://activities.local/users/bob/statuses/p2',
      actor: mockBob,
      createdAt: BASE_TIME + 500,
      text: 'Original post by Bob'
    })
    const boost1 = createMockAnnounce({
      id: 'https://activities.local/users/alice/statuses/b1',
      actor: mockAlice,
      createdAt: BASE_TIME + 1000,
      originalStatus: target2
    })
    const post3 = createMockNote({
      id: 'https://activities.local/users/alice/statuses/p3',
      actor: mockAlice,
      createdAt: BASE_TIME + 2000,
      text: 'Third post by Alice'
    })

    const statuses = [post3, boost1, post1]

    render(
      <TimelineFeed
        host="activities.local"
        currentTime={BASE_TIME + 5000}
        statuses={statuses}
      />
    )

    expect(screen.queryByLabelText('Thread')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Conversation')).not.toBeInTheDocument()

    expect(screen.getByText('First post by Alice')).toBeInTheDocument()
    expect(screen.getByText('Original post by Bob')).toBeInTheDocument()
    expect(screen.getByText('Third post by Alice')).toBeInTheDocument()

    expect(screen.getByText(/Boosted by/i)).toBeInTheDocument()

    const t3 = screen.getByText('Third post by Alice')
    const tb = screen.getByText('Original post by Bob')
    const t1 = screen.getByText('First post by Alice')

    expect(
      t3.compareDocumentPosition(tb) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      tb.compareDocumentPosition(t1) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('renders consecutive boosts as individual timeline rows even when count >= 3', () => {
    const target1 = createMockNote({
      id: 'https://activities.local/users/bob/statuses/b-target-1',
      actor: mockBob,
      text: 'Boosted note 1'
    })
    const target2 = createMockNote({
      id: 'https://activities.local/users/bob/statuses/b-target-2',
      actor: mockBob,
      text: 'Boosted note 2'
    })
    const target3 = createMockNote({
      id: 'https://activities.local/users/bob/statuses/b-target-3',
      actor: mockBob,
      text: 'Boosted note 3'
    })

    const boost1 = createMockAnnounce({
      id: 'https://activities.local/users/alice/statuses/announce-1',
      actor: mockAlice,
      originalStatus: target1
    })
    const boost2 = createMockAnnounce({
      id: 'https://activities.local/users/alice/statuses/announce-2',
      actor: mockAlice,
      originalStatus: target2
    })
    const boost3 = createMockAnnounce({
      id: 'https://activities.local/users/alice/statuses/announce-3',
      actor: mockAlice,
      originalStatus: target3
    })

    render(
      <TimelineFeed
        host="activities.local"
        currentTime={BASE_TIME + 10000}
        statuses={[boost1, boost2, boost3]}
      />
    )

    expect(screen.getByText('Boosted note 1')).toBeInTheDocument()
    expect(screen.getByText('Boosted note 2')).toBeInTheDocument()
    expect(screen.getByText('Boosted note 3')).toBeInTheDocument()

    const allBoostIndicators = screen.getAllByText(/Boosted by/i)
    expect(allBoostIndicators).toHaveLength(3)
  })
  describe('viewer albums owner', () => {
    const noteWithPhoto = (author: typeof mockAlice) => {
      const id = `https://activities.local/users/${author.username}/statuses/photo`
      return createMockNote({
        id,
        actor: author,
        actorId: author.id,
        text: 'A heron',
        attachments: [createMockPhoto({ id, actorId: author.id }, 'A heron')]
      })
    }

    const open = (statuses: Status[], currentActor?: typeof mockAlice) => {
      render(
        <TimelineFeed
          host="activities.local"
          currentActor={currentActor}
          currentTime={BASE_TIME + 1000}
          statuses={statuses}
        />
      )
      fireEvent.click(
        screen.getByRole('button', { name: 'Open media: A heron' })
      )
    }

    it('offers the owner the albums pill on their own photo', () => {
      open([noteWithPhoto(mockAlice)], mockAlice)

      expect(screen.getByTestId('viewer')).toHaveAttribute(
        'data-albums-owner',
        mockAlice.id
      )
    })

    it('offers nobody else’s photo a pill', () => {
      open([noteWithPhoto(mockBob)], mockAlice)

      expect(screen.getByTestId('viewer')).toHaveAttribute(
        'data-albums-owner',
        'none'
      )
    })

    it('offers a signed-out viewer none', () => {
      open([noteWithPhoto(mockAlice)])

      expect(screen.getByTestId('viewer')).toHaveAttribute(
        'data-albums-owner',
        'none'
      )
    })

    it('goes by who wrote a boosted post, not who boosted it', () => {
      const boost = createMockAnnounce({
        id: 'https://activities.local/users/alice/statuses/boost',
        originalStatus: noteWithPhoto(mockBob),
        actor: mockAlice
      })
      open([boost], mockAlice)

      expect(screen.getByTestId('viewer')).toHaveAttribute(
        'data-albums-owner',
        'none'
      )
    })
  })

  describe('re-rendering rows', () => {
    const rows = Array.from({ length: 20 }, (_, index) =>
      createMockNote({
        id: `https://activities.local/users/alice/statuses/row-${index}`,
        actor: mockAlice,
        createdAt: BASE_TIME + (20 - index) * 1000,
        text: `Row ${index}`
      })
    )
    const props = {
      host: 'activities.local',
      currentActor: mockAlice,
      currentTime: BASE_TIME + 100000,
      showActions: true
    }
    const renderList = (statuses: Status[] = rows) => {
      const view = render(<TimelineFeed {...props} statuses={statuses} />)
      return {
        rerender: (next: Status[] = statuses) =>
          view.rerender(<TimelineFeed {...props} statuses={next} />)
      }
    }
    const reply = (index: number) =>
      fireEvent.click(
        screen.getAllByRole('button', { name: /Reply to post/ })[index]
      )
    const rendered = (list: Status[] = rows) =>
      list.filter((row) => postRenders.get(row.id))

    beforeEach(() => {
      postRenders.clear()
      bodyRenders.clear()
    })

    it('leaves the other rows alone when the composer opens, moves and closes', () => {
      renderList()
      expect(rendered()).toHaveLength(20)

      postRenders.clear()
      reply(3)
      expect(screen.getByTestId('inline-composer')).toBeInTheDocument()
      expect(rendered().filter((row) => row !== rows[3])).toHaveLength(0)

      postRenders.clear()
      reply(5)
      expect(screen.getAllByTestId('inline-composer')).toHaveLength(1)
      expect(
        rendered().filter((row) => row !== rows[3] && row !== rows[5])
      ).toHaveLength(0)

      postRenders.clear()
      fireEvent.click(screen.getByRole('button', { name: 'Cancel composer' }))
      expect(screen.queryByTestId('inline-composer')).not.toBeInTheDocument()
      expect(rendered().filter((row) => row !== rows[5])).toHaveLength(0)
    })

    it('renders no row again for a rerender with the same props', () => {
      const view = renderList()
      postRenders.clear()
      view.rerender()
      expect(rendered()).toHaveLength(0)
    })

    it('re-renders every row when a shared prop such as currentTime changes', () => {
      const base = {
        host: 'activities.local',
        currentActor: mockAlice,
        showActions: true,
        statuses: rows
      }
      const view = render(
        <TimelineFeed {...base} currentTime={BASE_TIME + 100000} />
      )
      postRenders.clear()
      view.rerender(
        <TimelineFeed {...base} currentTime={BASE_TIME + 100000 + 60000} />
      )
      expect(rendered()).toHaveLength(rows.length)
    })

    it('re-renders only the row whose status changed', () => {
      const view = renderList()
      postRenders.clear()
      const liked = { ...rows[7], totalLikes: 1 } as Status
      view.rerender(rows.map((row, index) => (index === 7 ? liked : row)))
      expect(rendered(rows).map((row) => row.id)).toEqual([rows[7].id])
    })

    it('leaves a combined row alone when an unrelated row changes', () => {
      const first = createMockNote({
        id: 'https://activities.local/users/alice/statuses/combo-1',
        actor: mockAlice,
        createdAt: BASE_TIME + 500000,
        text: 'Combo 1'
      })
      const second = createMockNote({
        id: 'https://activities.local/users/alice/statuses/combo-2',
        actor: mockAlice,
        createdAt: BASE_TIME + 501000,
        text: 'Combo 2',
        reply: first.id
      })
      const plain = rows[7]
      const list = [second, first, plain]
      const view = renderList(list)
      expect(screen.getByText('Combo 2')).toBeInTheDocument()
      expect(bodyRenders.get(first.id)).toBeGreaterThan(0)

      bodyRenders.clear()
      postRenders.clear()
      const liked = { ...plain, totalLikes: 1 } as Status
      view.rerender([second, first, liked])

      expect(postRenders.get(plain.id)).toBeGreaterThan(0)
      expect(bodyRenders.get(first.id)).toBeUndefined()
      expect(bodyRenders.get(second.id)).toBeUndefined()
    })

    it('leaves other rows alone when a thread expands', () => {
      const thread = Array.from({ length: 5 }, (_, index) =>
        createMockNote({
          id: `https://activities.local/users/alice/statuses/thread-${index}`,
          actor: mockAlice,
          createdAt: BASE_TIME + 200000 + index * 1000,
          text: `Thread ${index}`,
          reply:
            index === 0
              ? ''
              : `https://activities.local/users/alice/statuses/thread-${index - 1}`
        })
      )
      renderList([...thread.slice().reverse(), ...rows])
      postRenders.clear()

      fireEvent.click(
        screen.getByRole('button', { name: /Show 3 earlier posts in thread/i })
      )

      expect(screen.getByText('Thread 2')).toBeInTheDocument()
      expect(rendered(rows)).toHaveLength(0)
    })
  })
})
