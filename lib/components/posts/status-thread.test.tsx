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
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'

import { createNote, deleteStatus, updateNote } from '@/lib/client'
import {
  BASE_TIME,
  createMockNote,
  createMockPhoto,
  mockAlice,
  mockBob,
  mockCarol,
  mockDave
} from '@/lib/components/posts/__fixtures__/timeline-context'
import { StatusThread } from '@/lib/components/posts/status-thread'
import type { Status } from '@/lib/types/domain/status'

import { preloadInlineStatusComposer } from './lazy-inline-status-composer'

const mockPush = vi.fn()
const mockRefresh = vi.fn()
let mockClampCollapsible = false

vi.mock('./collapsible-content', () => ({
  CollapsibleContent: ({ children }: { children: ReactNode }) => (
    <div>
      {children}
      {mockClampCollapsible ? (
        <button type="button" aria-label="Show more content">
          Show more
        </button>
      ) : null}
    </div>
  )
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh
  })
}))

vi.mock('@/lib/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/client')>()
  return {
    ...actual,
    createNote: vi.fn(),
    deleteStatus: vi.fn(),
    likeStatus: vi.fn(),
    updateNote: vi.fn(),
    undoLikeStatus: vi.fn(),
    getTranslationCapability: vi.fn().mockResolvedValue({ enabled: false }),
    getTranslationLanguages: vi.fn().mockResolvedValue([])
  }
})

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

const mockCreateNote = vi.mocked(createNote)
const mockDeleteStatus = vi.mocked(deleteStatus)
const mockUpdateNote = vi.mocked(updateNote)

// The inline composer is loaded lazily; preload it so it renders synchronously.
beforeAll(async () => {
  await preloadInlineStatusComposer()
})

describe('StatusThread', () => {
  const host = 'activities.local'

  beforeEach(() => {
    vi.clearAllMocks()
    mockClampCollapsible = false
  })

  it('renders ancestors, focused status, and descendants in order', () => {
    const root = createMockNote({
      id: 'https://activities.local/users/bob/statuses/root',
      actor: mockBob,
      actorId: mockBob.id,
      text: 'Ancestor Root',
      createdAt: BASE_TIME
    })

    const focused = createMockNote({
      id: 'https://activities.local/users/alice/statuses/focused',
      actor: mockAlice,
      actorId: mockAlice.id,
      reply: root.id,
      text: 'Focused Status',
      createdAt: BASE_TIME + 60000
    })

    const descendant = createMockNote({
      id: 'https://activities.local/users/bob/statuses/reply1',
      actor: mockBob,
      actorId: mockBob.id,
      reply: focused.id,
      text: 'Direct Reply from Bob',
      createdAt: BASE_TIME + 120000
    })

    render(
      <StatusThread
        host={host}
        status={focused}
        ancestors={[root]}
        descendants={[descendant]}
        currentTime={BASE_TIME + 200000}
      />
    )

    expect(screen.getByTestId('thread-ancestors')).toBeInTheDocument()
    expect(screen.getByTestId('focused-status')).toBeInTheDocument()
    expect(screen.getByTestId('thread-descendants')).toBeInTheDocument()

    expect(screen.getByText('Ancestor Root')).toBeInTheDocument()
    expect(screen.getByText('Focused Status')).toBeInTheDocument()
    expect(screen.getByText('Direct Reply from Bob')).toBeInTheDocument()
  })

  it("centres only the focused post's header row on its avatar", () => {
    const root = createMockNote({
      id: 'https://activities.local/users/bob/statuses/root',
      actor: mockBob,
      actorId: mockBob.id,
      text: 'Ancestor Root',
      createdAt: BASE_TIME
    })
    const focused = createMockNote({
      id: 'https://activities.local/users/alice/statuses/focused',
      actor: mockAlice,
      actorId: mockAlice.id,
      reply: root.id,
      text: 'Focused Status',
      createdAt: BASE_TIME + 60000
    })
    const descendant = createMockNote({
      id: 'https://activities.local/users/bob/statuses/reply1',
      actor: mockBob,
      actorId: mockBob.id,
      reply: focused.id,
      text: 'Direct Reply from Bob',
      createdAt: BASE_TIME + 120000
    })

    render(
      <StatusThread
        host={host}
        status={focused}
        ancestors={[root]}
        descendants={[descendant]}
        currentTime={BASE_TIME + 200000}
      />
    )

    // The status detail board draws the focused post's name row on the
    // avatar's centre; ancestors and replies are rows, aligned to the top.
    const headerRow = (testId: string) =>
      screen
        .getByTestId(testId)
        .querySelector('.flex-1 > .flex.flex-wrap.items-center')
    expect(headerRow('focused-status')).toHaveClass('mt-2.5')
    expect(headerRow(`status-${root.id}`)).not.toHaveClass('mt-2.5')
    expect(headerRow(`status-${descendant.id}`)).not.toHaveClass('mt-2.5')
  })

  // A signed-in thread sits in the full-bleed feed surface below `md`, so each
  // row that rounds its top corner on desktop resets to square there. A
  // logged-out thread is an inset card at every width, so its first row keeps
  // the card's top corners below `md` too: a reset would let its square
  // `bg-background` bleed past the card's rounded border.
  it('renders empty state when there are no replies', () => {
    const focused = createMockNote({
      id: 'https://activities.local/users/alice/statuses/lonely',
      actor: mockAlice,
      actorId: mockAlice.id,
      text: 'Lonely Status',
      createdAt: BASE_TIME
    })

    render(
      <StatusThread host={host} status={focused} currentTime={BASE_TIME} />
    )

    expect(screen.getByText('No replies yet')).toBeInTheDocument()
    expect(screen.getByText('Replies show up here.')).toBeInTheDocument()
  })

  it('hides the empty state under the last post of a conversation', () => {
    const root = createMockNote({
      id: 'https://activities.local/users/bob/statuses/root',
      actor: mockBob,
      actorId: mockBob.id,
      text: 'Ancestor Root',
      createdAt: BASE_TIME
    })
    const focused = createMockNote({
      id: 'https://activities.local/users/alice/statuses/last',
      actor: mockAlice,
      actorId: mockAlice.id,
      reply: root.id,
      text: 'Last Reply',
      createdAt: BASE_TIME + 60000
    })

    render(
      <StatusThread
        host={host}
        status={focused}
        ancestors={[root]}
        currentActor={mockAlice}
        currentTime={BASE_TIME + 100000}
      />
    )

    expect(screen.queryByText('No replies yet')).not.toBeInTheDocument()
    // Nothing follows it, so the focused post closes the frame itself.
    expect(screen.getByTestId('focused-status')).toHaveClass(
      'border-b-0',
      'rounded-b-lg'
    )
  })

  it('hides the empty state for a reply whose parent is unavailable', () => {
    const focused = createMockNote({
      id: 'https://activities.local/users/alice/statuses/orphan',
      actor: mockAlice,
      actorId: mockAlice.id,
      reply: 'https://remote.test/statuses/gone',
      text: 'Orphan Reply',
      createdAt: BASE_TIME
    })

    render(
      <StatusThread host={host} status={focused} currentTime={BASE_TIME} />
    )

    expect(screen.queryByText('No replies yet')).not.toBeInTheDocument()
    // Logged out, the sign-in block follows inside the desktop frame, so only
    // the mobile inset card ends at the focused post.
    const focusedRow = screen.getByTestId('focused-status')
    expect(focusedRow).toHaveClass('border-b', 'max-md:rounded-b-lg')
    expect(focusedRow).not.toHaveClass('border-b-0')
  })

  it('swaps the empty state for the reply composer until it is cancelled', async () => {
    const focused = createMockNote({
      id: 'https://activities.local/users/alice/statuses/lonely',
      actor: mockBob,
      actorId: mockBob.id,
      text: 'Lonely Status',
      createdAt: BASE_TIME
    })

    render(
      <StatusThread
        host={host}
        status={focused}
        currentActor={mockAlice}
        currentTime={BASE_TIME}
      />
    )

    expect(screen.getByText('No replies yet')).toBeInTheDocument()
    expect(screen.getByText('Be the first to reply.')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(/Reply/i))

    expect(
      await screen.findByPlaceholderText(/Reply to Bob/i)
    ).toBeInTheDocument()
    expect(screen.queryByText('No replies yet')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(
      screen.queryByPlaceholderText(/Reply to Bob/i)
    ).not.toBeInTheDocument()
    expect(screen.getByText('No replies yet')).toBeInTheDocument()
  })

  it('renders focusedFooter when provided', () => {
    const focused = createMockNote({
      id: 'https://activities.local/users/alice/statuses/focused',
      actor: mockAlice,
      actorId: mockAlice.id,
      text: 'Focused Status',
      createdAt: BASE_TIME
    })

    render(
      <StatusThread
        host={host}
        status={focused}
        currentTime={BASE_TIME}
        focusedFooter={
          <div data-testid="custom-focused-footer">Footer Content</div>
        }
      />
    )

    expect(screen.getByTestId('custom-focused-footer')).toBeInTheDocument()
    expect(screen.getByText('Footer Content')).toBeInTheDocument()
  })

  it('opens inline composer targeting the specific reply when clicking reply', () => {
    const focused = createMockNote({
      id: 'https://activities.local/users/alice/statuses/focused',
      actor: mockAlice,
      actorId: mockAlice.id,
      text: 'Focused Status',
      createdAt: BASE_TIME
    })

    const reply = createMockNote({
      id: 'https://activities.local/users/bob/statuses/bob-reply',
      actor: mockBob,
      actorId: mockBob.id,
      reply: focused.id,
      text: 'Bob reply to be replied to',
      createdAt: BASE_TIME + 60000
    })

    render(
      <StatusThread
        host={host}
        status={focused}
        descendants={[reply]}
        currentActor={mockAlice}
        currentTime={BASE_TIME + 100000}
      />
    )

    // Look for reply action buttons. Both focused and reply have reply buttons.
    const replyButtons = screen.getAllByLabelText(/Reply/i)
    expect(replyButtons.length).toBeGreaterThanOrEqual(2)

    // Click reply on Bob's reply (the second reply button)
    fireEvent.click(replyButtons[1])

    // The inline composer should open for Bob's reply
    expect(screen.getByPlaceholderText(/Reply to Bob/i)).toBeInTheDocument()
  })

  it('renders collapse toggle and expands collapsed branches on click', () => {
    const focused = createMockNote({
      id: 'https://activities.local/users/alice/statuses/focused',
      actor: mockAlice,
      actorId: mockAlice.id,
      text: 'Focused with many replies',
      createdAt: BASE_TIME
    })

    const b1 = createMockNote({
      id: 'https://activities.local/users/bob/statuses/b1',
      actor: mockBob,
      actorId: mockBob.id,
      reply: focused.id,
      text: 'Top level Bob reply',
      createdAt: BASE_TIME + 1000
    })

    // Create 9 sub-replies so total descendants = 10 (triggers collapse)
    const subReplies = Array.from({ length: 9 }, (_, i) =>
      createMockNote({
        id: `https://activities.local/users/carol/statuses/sub-${i}`,
        actor: mockCarol,
        actorId: mockCarol.id,
        reply: b1.id,
        text: `Sub reply ${i}`,
        createdAt: BASE_TIME + 2000 + i * 1000
      })
    )

    render(
      <StatusThread
        host={host}
        status={focused}
        descendants={[b1, ...subReplies]}
        currentTime={BASE_TIME + 50000}
      />
    )

    // Initially, sub-replies are collapsed
    expect(screen.getByText('Top level Bob reply')).toBeInTheDocument()
    expect(screen.queryByText('Sub reply 0')).not.toBeInTheDocument()

    const toggleButton = screen.getByTestId(`toggle-replies-${b1.id}`)
    expect(toggleButton).toHaveTextContent('Show 9 more replies')

    // Click to expand
    fireEvent.click(toggleButton)

    // Now sub-replies are visible
    expect(screen.getByText('Sub reply 0')).toBeInTheDocument()
    expect(toggleButton).toHaveTextContent('Hide replies')
  })

  it('renders unavailable parent boundary when parentUnavailable is true', () => {
    const focused = createMockNote({
      id: 'https://activities.local/users/alice/statuses/focused',
      actor: mockAlice,
      actorId: mockAlice.id,
      text: 'Focused Status',
      createdAt: BASE_TIME
    })

    const orphan = createMockNote({
      id: 'https://activities.local/users/bob/statuses/orphan',
      actor: mockBob,
      actorId: mockBob.id,
      reply: 'https://activities.local/users/missing/statuses/deleted-999',
      text: 'Orphan reply to missing parent',
      createdAt: BASE_TIME + 1000
    })

    render(
      <StatusThread
        host={host}
        status={focused}
        descendants={[orphan]}
        currentTime={BASE_TIME + 5000}
      />
    )

    expect(
      screen.getByTestId('parent-unavailable-boundary')
    ).toBeInTheDocument()
    expect(screen.getByText('Prior reply is unavailable')).toBeInTheDocument()
    expect(
      screen.getByText('Orphan reply to missing parent')
    ).toBeInTheDocument()
  })

  it('merges new reply into localDescendants, expands parent branch, and renders ReplyToast', async () => {
    const focused = createMockNote({
      id: 'https://activities.local/users/alice/statuses/focused',
      actor: mockAlice,
      actorId: mockAlice.id,
      text: 'Focused with replies',
      createdAt: BASE_TIME
    })

    const b1 = createMockNote({
      id: 'https://activities.local/users/bob/statuses/b1',
      actor: mockBob,
      actorId: mockBob.id,
      reply: focused.id,
      text: 'Top level Bob reply',
      createdAt: BASE_TIME + 1000
    })

    // 9 sub-replies so total descendants = 10 (triggers initiallyCollapsed for b1)
    const subReplies = Array.from({ length: 9 }, (_, i) =>
      createMockNote({
        id: `https://activities.local/users/carol/statuses/sub-${i}`,
        actor: mockCarol,
        actorId: mockCarol.id,
        reply: b1.id,
        text: `Sub reply ${i}`,
        createdAt: BASE_TIME + 2000 + i * 1000
      })
    )

    const newReply = createMockNote({
      id: 'https://activities.local/users/alice/statuses/new-reply-to-b1',
      actor: mockAlice,
      actorId: mockAlice.id,
      reply: b1.id,
      text: 'Alice answers Bob in thread',
      createdAt: BASE_TIME + 20000
    })

    mockCreateNote.mockResolvedValueOnce({
      status: newReply,
      attachments: []
    })

    const onReplyCreated = vi.fn()

    render(
      <StatusThread
        host={host}
        status={focused}
        descendants={[b1, ...subReplies]}
        currentActor={mockAlice}
        currentTime={BASE_TIME + 50000}
        onReplyCreated={onReplyCreated}
      />
    )

    // Initially, b1 is collapsed
    expect(screen.getByText('Top level Bob reply')).toBeInTheDocument()
    expect(screen.queryByText('Sub reply 0')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Alice answers Bob in thread')
    ).not.toBeInTheDocument()

    // Click reply on b1 (second reply button)
    const replyButtons = screen.getAllByLabelText(/Reply/i)
    fireEvent.click(replyButtons[1])

    // Reply box appears for Bob
    const textarea = screen.getByPlaceholderText(/Reply to Bob/i)
    fireEvent.change(textarea, {
      target: { value: 'Alice answers Bob in thread' }
    })

    // Click Post
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => {
      expect(mockCreateNote).toHaveBeenCalled()
    })

    // ReplyToast should appear
    await waitFor(() => {
      expect(screen.getByText('Reply posted')).toBeInTheDocument()
    })

    // b1's branch should be expanded now
    expect(screen.getByText('Sub reply 0')).toBeInTheDocument()
    expect(screen.getByText('Alice answers Bob in thread')).toBeInTheDocument()

    // onReplyCreated callback was called with newReply
    expect(onReplyCreated).toHaveBeenCalledWith(newReply)

    // router.refresh is NOT called on reply creation to prevent page scroll resetting to top
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('nests reply directly beneath ancestor when replying to an ancestor', async () => {
    const root = createMockNote({
      id: 'https://activities.local/users/carol/statuses/root',
      actor: mockCarol,
      actorId: mockCarol.id,
      text: 'Ancestor Root Post',
      createdAt: BASE_TIME
    })

    const focused = createMockNote({
      id: 'https://activities.local/users/alice/statuses/focused',
      actor: mockAlice,
      actorId: mockAlice.id,
      reply: root.id,
      text: 'Focused Status',
      createdAt: BASE_TIME + 60000
    })

    const replyToAncestor = createMockNote({
      id: 'https://activities.local/users/bob/statuses/reply-to-root',
      actor: mockBob,
      actorId: mockBob.id,
      reply: root.id,
      text: 'Direct reply beneath Ancestor Root',
      createdAt: BASE_TIME + 70000
    })

    mockCreateNote.mockResolvedValueOnce({
      status: replyToAncestor,
      attachments: []
    })

    render(
      <StatusThread
        host={host}
        status={focused}
        ancestors={[root]}
        descendants={[]}
        currentActor={mockBob}
        currentTime={BASE_TIME + 100000}
      />
    )

    // Click reply on the ancestor post (first reply button)
    const replyButtons = screen.getAllByLabelText(/Reply/i)
    fireEvent.click(replyButtons[0])

    // Reply box appears for Carol
    const textarea = screen.getByPlaceholderText(/Reply to Carol/i)
    fireEvent.change(textarea, {
      target: { value: 'Direct reply beneath Ancestor Root' }
    })

    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => {
      expect(mockCreateNote).toHaveBeenCalled()
    })

    // The reply appears directly within ancestor-status
    await waitFor(() => {
      const ancestorContainer = screen.getByTestId('ancestor-status')
      expect(ancestorContainer).toHaveTextContent(
        'Direct reply beneath Ancestor Root'
      )
    })

    // No orphan or parent unavailable boundary
    expect(
      screen.queryByTestId('parent-unavailable-boundary')
    ).not.toBeInTheDocument()

    // router.refresh was not called
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('places newly created reply directly next to focused status at top of replies', async () => {
    const focused = createMockNote({
      id: 'https://activities.local/users/alice/statuses/focused',
      actor: mockAlice,
      actorId: mockAlice.id,
      text: 'Focused Status',
      createdAt: BASE_TIME
    })

    const existingOlderReply = createMockNote({
      id: 'https://activities.local/users/bob/statuses/existing-old',
      actor: mockBob,
      actorId: mockBob.id,
      reply: focused.id,
      text: 'Existing Older Reply',
      createdAt: BASE_TIME + 1000
    })

    const newReply = createMockNote({
      id: 'https://activities.local/users/carol/statuses/brand-new',
      actor: mockCarol,
      actorId: mockCarol.id,
      reply: focused.id,
      text: 'Brand New Reply',
      createdAt: BASE_TIME + 50000
    })

    mockCreateNote.mockResolvedValueOnce({
      status: newReply,
      attachments: []
    })

    render(
      <StatusThread
        host={host}
        status={focused}
        ancestors={[]}
        descendants={[existingOlderReply]}
        currentActor={mockCarol}
        currentTime={BASE_TIME + 60000}
      />
    )

    // Reply to focused post
    const replyButtons = screen.getAllByLabelText(/Reply/i)
    fireEvent.click(replyButtons[0])

    const textarea = screen.getByPlaceholderText(/Reply to Alice/i)
    fireEvent.change(textarea, { target: { value: 'Brand New Reply' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => {
      expect(mockCreateNote).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(screen.getByText('Brand New Reply')).toBeInTheDocument()
    })

    // Verify ordering: Brand New Reply appears before Existing Older Reply
    const newReplyEl = screen.getByText('Brand New Reply')
    const oldReplyEl = screen.getByText('Existing Older Reply')
    expect(
      newReplyEl.compareDocumentPosition(oldReplyEl) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  describe('scrolling to a newly posted reply', () => {
    const focused = createMockNote({
      id: 'https://activities.local/users/alice/statuses/scroll-focused',
      actor: mockAlice,
      actorId: mockAlice.id,
      text: 'Scroll Focused',
      createdAt: BASE_TIME
    })
    const newReply = createMockNote({
      id: 'https://activities.local/users/carol/statuses/scroll-reply',
      actor: mockCarol,
      actorId: mockCarol.id,
      reply: focused.id,
      text: 'Scroll Reply',
      createdAt: BASE_TIME + 5000
    })
    const scrollIntoView = vi.fn()

    beforeEach(() => {
      scrollIntoView.mockReset()
      // jsdom does not implement scrollIntoView; the component feature-checks it.
      Element.prototype.scrollIntoView = scrollIntoView
      mockCreateNote.mockResolvedValueOnce({
        status: newReply,
        attachments: []
      })
    })

    afterEach(() => {
      vi.useRealTimers()
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    })

    const postReply = async () => {
      vi.useFakeTimers()
      const view = render(
        <StatusThread
          host={host}
          status={focused}
          ancestors={[]}
          descendants={[]}
          currentActor={mockCarol}
          currentTime={BASE_TIME + 60000}
        />
      )
      fireEvent.click(screen.getAllByLabelText(/Reply/i)[0])
      fireEvent.change(screen.getByPlaceholderText(/Reply to Alice/i), {
        target: { value: 'Scroll Reply' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))
      // Settle the mocked createNote without moving the clock, so the reply
      // lands and the 50 ms scroll is armed but has not fired yet.
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(screen.getByText('Scroll Reply')).toBeInTheDocument()
      return view
    }

    it('scrolls the new reply into view once the deferred tick fires', async () => {
      await postReply()
      expect(scrollIntoView).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(50)
      })

      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(scrollIntoView.mock.contexts[0]).toBe(
        document.querySelector(`[data-node-id="${newReply.id}"]`) ??
          document.querySelector(`[data-testid="status-${newReply.id}"]`)
      )
    })

    it('cancels the pending scroll when the thread unmounts', async () => {
      const { unmount } = await postReply()
      unmount()
      // After unmount the reply element is gone, so "scrollIntoView was not
      // called" would hold even if the timer still fired. Watch the timer's own
      // lookup instead: it must never run.
      const querySelector = vi.spyOn(document, 'querySelector')

      act(() => {
        vi.advanceTimersByTime(50)
      })

      expect(
        querySelector.mock.calls.filter(([selector]) =>
          String(selector).includes(newReply.id)
        )
      ).toEqual([])
      querySelector.mockRestore()
    })
  })
  describe('viewer albums owner', () => {
    const withPhoto = (
      id: string,
      author: typeof mockAlice,
      name: string,
      reply = ''
    ) =>
      createMockNote({
        id,
        actor: author,
        actorId: author.id,
        text: name,
        reply,
        attachments: [createMockPhoto({ id, actorId: author.id }, name)]
      })

    const ancestorId = 'https://activities.local/users/bob/statuses/ancestor'
    const focusedId = 'https://activities.local/users/alice/statuses/focused'
    const replyId = 'https://activities.local/users/carol/statuses/reply'

    const open = (name: string, currentActor: typeof mockAlice | null) => {
      const ancestor = withPhoto(ancestorId, mockBob, 'Ancestor photo')
      const focused = withPhoto(
        focusedId,
        mockAlice,
        'Focused photo',
        ancestorId
      )
      const reply = withPhoto(replyId, mockAlice, 'Reply photo', focusedId)
      render(
        <StatusThread
          host={host}
          status={focused}
          ancestors={[ancestor]}
          descendants={[reply]}
          currentActor={currentActor}
          currentTime={BASE_TIME + 200000}
        />
      )
      fireEvent.click(
        screen.getByRole('button', { name: `Open media: ${name}` })
      )
      return screen.getByTestId('viewer')
    }

    it('offers the owner the albums pill on their focused post', () => {
      expect(open('Focused photo', mockAlice)).toHaveAttribute(
        'data-albums-owner',
        mockAlice.id
      )
    })

    it('offers it on their own reply in the thread', () => {
      expect(open('Reply photo', mockAlice)).toHaveAttribute(
        'data-albums-owner',
        mockAlice.id
      )
    })

    it('offers none on somebody else’s ancestor post', () => {
      expect(open('Ancestor photo', mockAlice)).toHaveAttribute(
        'data-albums-owner',
        'none'
      )
    })

    it('offers a signed-out viewer none', () => {
      expect(open('Focused photo', null)).toHaveAttribute(
        'data-albums-owner',
        'none'
      )
    })
  })

  it('prioritizes only the focused post image, not ancestors or replies', () => {
    const withPhoto = <T extends { id: string; actorId: string }>(
      note: T,
      name: string
    ) => ({
      ...note,
      attachments: [
        {
          ...createMockPhoto(note, name),
          blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj'
        }
      ]
    })

    const root = withPhoto(
      createMockNote({
        id: 'https://activities.local/users/alice/statuses/root',
        actor: mockAlice,
        actorId: mockAlice.id,
        text: 'Ancestor Root',
        createdAt: BASE_TIME
      }),
      'root-photo'
    )
    const focused = withPhoto(
      createMockNote({
        id: 'https://activities.local/users/alice/statuses/focused',
        actor: mockAlice,
        actorId: mockAlice.id,
        reply: root.id,
        text: 'Focused Status',
        createdAt: BASE_TIME + 60000
      }),
      'focused-photo'
    )
    const descendant = withPhoto(
      createMockNote({
        id: 'https://activities.local/users/bob/statuses/reply1',
        actor: mockBob,
        actorId: mockBob.id,
        reply: focused.id,
        text: 'Reply',
        createdAt: BASE_TIME + 120000
      }),
      'reply-photo'
    )

    render(
      <StatusThread
        host={host}
        status={focused}
        ancestors={[root]}
        descendants={[descendant]}
        currentTime={BASE_TIME + 200000}
      />
    )

    expect(document.querySelector('[fetchpriority]')).toBeNull()
    const priority = document.querySelectorAll('img.opacity-100')
    expect(priority).toHaveLength(1)
    expect(screen.getByTestId('focused-status')).toContainElement(
      priority[0] as HTMLElement
    )
    expect(priority[0]).toHaveAttribute(
      'src',
      expect.stringContaining('focused-photo')
    )
  })

  describe('self-thread run (Layout B)', () => {
    const MINUTE = 60 * 1000

    const makeAliceRun = (count: number) => {
      const notes: ReturnType<typeof createMockNote>[] = []
      for (let i = 0; i < count; i++) {
        const prev = notes[i - 1]
        notes.push(
          createMockNote({
            id: `https://activities.local/users/alice/statuses/run-${i + 1}`,
            actor: mockAlice,
            actorId: mockAlice.id,
            reply: prev ? prev.id : '',
            text: `Run part ${i + 1} content`,
            createdAt: BASE_TIME + i * 2 * MINUTE
          })
        )
      }
      return notes
    }

    const makeTwoRuns = () => {
      const [a1, a2] = makeAliceRun(2)
      const a3 = createMockNote({
        id: 'https://activities.local/users/alice/statuses/later-1',
        actor: mockAlice,
        actorId: mockAlice.id,
        reply: a2.id,
        text: 'Later run part 1',
        createdAt: BASE_TIME + 25 * MINUTE
      })
      const a4 = createMockNote({
        id: 'https://activities.local/users/alice/statuses/later-2',
        actor: mockAlice,
        actorId: mockAlice.id,
        reply: a3.id,
        text: 'Later run part 2',
        createdAt: BASE_TIME + 27 * MINUTE
      })
      return { a1, a2, a3, a4 }
    }

    it('renders opened last part inside a combined run with time span header, per-part actions, and focusedFooter inside opened part', () => {
      const [a1, a2, a3] = makeAliceRun(3)

      render(
        <StatusThread
          host={host}
          status={a3}
          ancestors={[a1, a2]}
          descendants={[]}
          currentActor={mockAlice}
          currentTime={BASE_TIME + 16 * MINUTE}
          focusedFooter={
            <div data-testid="opened-part-footer">Opened Footer</div>
          }
        />
      )

      expect(screen.queryByTestId('thread-ancestors')).not.toBeInTheDocument()
      expect(screen.getByTestId('self-thread-run')).toBeInTheDocument()

      // Part 1 header shows the time span ("16m – 12m")
      expect(screen.getByText('16m – 12m')).toBeInTheDocument()
      // Part 2 has a clickable "2 of 3" label button
      expect(
        screen.getByRole('button', { name: /Open part 2 of 3/i })
      ).toBeInTheDocument()
      // Opened part 3 has author name in a static span ("Alice Smith · 3 of 3 · 12m")
      expect(screen.getByText('Alice Smith · 3 of 3 · 12m')).toBeInTheDocument()

      // Each of the 3 parts has its own action bar
      expect(
        screen.getAllByRole('group', { name: 'Post actions' })
      ).toHaveLength(3)

      // Opened part has aria-current="location" and contains focusedFooter
      const openedPart = screen.getByTestId(`status-${a3.id}`)
      expect(openedPart).toHaveAttribute('aria-current', 'location')
      expect(openedPart).toContainElement(
        screen.getByTestId('opened-part-footer')
      )
    })

    it("rounds the opened first part's tint like the focused card it bleeds into", () => {
      const [a1, a2] = makeAliceRun(2)

      render(
        <StatusThread
          host={host}
          status={a1}
          ancestors={[]}
          descendants={[a2]}
          currentTime={BASE_TIME + 16 * MINUTE}
        />
      )

      const card = screen.getByTestId('focused-status')
      expect(card).toHaveClass('rounded-t-lg')
      // The card has no overflow clip, so every wrapper down to the tinted
      // part inherits its top radius.
      let element = screen.getByTestId(`status-${a1.id}`)
      while (element !== card) {
        expect(element).toHaveClass('rounded-t-[inherit]')
        element = element.parentElement as HTMLElement
      }
    })

    it('marks opened middle part with aria-current="location" and scrolls it into view respecting prefers-reduced-motion', () => {
      const [a1, a2, a3] = makeAliceRun(3)
      const scrollIntoView = vi.fn()
      Element.prototype.scrollIntoView = scrollIntoView
      const originalMatchMedia = window.matchMedia

      try {
        window.matchMedia = vi.fn().mockReturnValue({ matches: false })
        const { unmount } = render(
          <StatusThread
            host={host}
            status={a2}
            ancestors={[a1]}
            descendants={[a3]}
            currentActor={mockAlice}
            currentTime={BASE_TIME + 16 * MINUTE}
          />
        )

        const openedMiddle = screen.getByTestId(`status-${a2.id}`)
        expect(openedMiddle).toHaveAttribute('aria-current', 'location')
        expect(screen.getByText('Alice Smith · 2 of 3 · 14m').tagName).toBe(
          'SPAN'
        )
        expect(
          screen.queryByRole('button', { name: /Open part 2 of 3/i })
        ).not.toBeInTheDocument()
        expect(
          screen.getByRole('button', { name: /Open part 3 of 3/i })
        ).toBeInTheDocument()

        expect(scrollIntoView).toHaveBeenCalledWith({
          behavior: 'smooth',
          block: 'nearest'
        })

        unmount()
        scrollIntoView.mockClear()

        window.matchMedia = vi.fn().mockReturnValue({ matches: true })
        render(
          <StatusThread
            host={host}
            status={a2}
            ancestors={[a1]}
            descendants={[a3]}
            currentActor={mockAlice}
            currentTime={BASE_TIME + 16 * MINUTE}
          />
        )

        expect(scrollIntoView).toHaveBeenCalledWith({
          behavior: 'auto',
          block: 'nearest'
        })
      } finally {
        window.matchMedia = originalMatchMedia
        Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
      }
    })

    it("keeps someone else's post above the run as a separate ancestor row", () => {
      const bobRoot = createMockNote({
        id: 'https://activities.local/users/bob/statuses/bob-root',
        actor: mockBob,
        actorId: mockBob.id,
        text: 'Bob Root Question',
        createdAt: BASE_TIME
      })
      const a1 = createMockNote({
        id: 'https://activities.local/users/alice/statuses/a1',
        actor: mockAlice,
        actorId: mockAlice.id,
        reply: bobRoot.id,
        text: 'Alice Part 1',
        createdAt: BASE_TIME + MINUTE
      })
      const a2 = createMockNote({
        id: 'https://activities.local/users/alice/statuses/a2',
        actor: mockAlice,
        actorId: mockAlice.id,
        reply: a1.id,
        text: 'Alice Part 2',
        createdAt: BASE_TIME + 2 * MINUTE
      })

      render(
        <StatusThread
          host={host}
          status={a2}
          ancestors={[bobRoot, a1]}
          descendants={[]}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )

      const ancestorRow = screen.getByTestId('ancestor-status')
      expect(ancestorRow).toHaveTextContent('Bob Root Question')
      expect(ancestorRow).not.toHaveTextContent('Alice Part 1')
      expect(screen.getByTestId('self-thread-run')).toHaveTextContent(
        'Alice Part 1'
      )
      expect(screen.getByTestId('self-thread-run')).toHaveTextContent(
        'Alice Part 2'
      )
    })

    // A reply to a later part of an ancestor run must nest under the run (the
    // row its first part keeps in the tree), not under the opened post's
    // "Replies", even though the run folds its later parts into one row.
    const makeAncestorRunWithOutsideReply = () => {
      const m1 = createMockNote({
        id: 'https://activities.local/users/maythee/statuses/m1',
        actor: mockAlice,
        actorId: mockAlice.id,
        text: 'Maythee run part 1',
        createdAt: BASE_TIME
      })
      const m2 = createMockNote({
        id: 'https://activities.local/users/maythee/statuses/m2',
        actor: mockAlice,
        actorId: mockAlice.id,
        reply: m1.id,
        text: 'Maythee run part 2',
        createdAt: BASE_TIME + MINUTE
      })
      const outsideReply = createMockNote({
        id: 'https://activities.local/users/carol/statuses/reply-to-m2',
        actor: mockCarol,
        actorId: mockCarol.id,
        reply: m2.id,
        text: 'Carol replies to part 2',
        createdAt: BASE_TIME + 4 * MINUTE
      })
      return { m1, m2, outsideReply }
    }

    const expectReplyUnderAncestorRun = () => {
      expect(
        within(screen.getByTestId('thread-ancestors')).getByText(
          'Carol replies to part 2'
        )
      ).toBeInTheDocument()
      const repliesSection = screen.queryByTestId('thread-descendants')
      if (repliesSection) {
        expect(
          within(repliesSection).queryByText('Carol replies to part 2')
        ).not.toBeInTheDocument()
      }
    }

    it('nests a reply to a part of an ancestor run under the run when opening another author’s reply', () => {
      const { m1, m2, outsideReply } = makeAncestorRunWithOutsideReply()
      const opened = createMockNote({
        id: 'https://activities.local/users/bob/statuses/opened-reply',
        actor: mockBob,
        actorId: mockBob.id,
        reply: m2.id,
        text: 'Veer opens their reply here',
        createdAt: BASE_TIME + 2 * MINUTE
      })

      render(
        <StatusThread
          host={host}
          status={opened}
          ancestors={[m1, m2]}
          descendants={[outsideReply]}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )

      expect(screen.getByTestId('self-thread-run')).toHaveTextContent(
        'Maythee run part 1'
      )
      expect(screen.getByTestId('ancestor-status')).toHaveTextContent(
        'Carol replies to part 2'
      )
      expectReplyUnderAncestorRun()
    })

    it('nests a reply to a part of an ancestor run under the run even when the opened post is by the run author', () => {
      const { m1, m2, outsideReply } = makeAncestorRunWithOutsideReply()
      const veerBetween = createMockNote({
        id: 'https://activities.local/users/bob/statuses/veer-between',
        actor: mockBob,
        actorId: mockBob.id,
        reply: m2.id,
        text: 'Veer post in between',
        createdAt: BASE_TIME + 2 * MINUTE
      })
      const m3 = createMockNote({
        id: 'https://activities.local/users/maythee/statuses/m3',
        actor: mockAlice,
        actorId: mockAlice.id,
        reply: veerBetween.id,
        text: 'Maythee continues after veer',
        createdAt: BASE_TIME + 3 * MINUTE
      })

      render(
        <StatusThread
          host={host}
          status={m3}
          ancestors={[m1, m2, veerBetween]}
          descendants={[outsideReply]}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )

      const runRow = screen
        .getAllByTestId('ancestor-status')
        .find((row) => row.textContent?.includes('Maythee run part 1'))
      expect(runRow).toBeDefined()
      expect(runRow).toHaveTextContent('Carol replies to part 2')
      expectReplyUnderAncestorRun()
    })

    // Maythee's two-part run with veer's reply to its second part: the shape
    // the "Replying to" line and the opened-row marker are built for.
    const makeAncestorRunWithOpenedReply = () => {
      const m1 = createMockNote({
        id: 'https://activities.local/users/maythee/statuses/run-m1',
        actor: mockAlice,
        actorId: mockAlice.id,
        text: 'Maythee run part 1',
        createdAt: BASE_TIME
      })
      const m2 = createMockNote({
        id: 'https://activities.local/users/maythee/statuses/run-m2',
        actor: mockAlice,
        actorId: mockAlice.id,
        reply: m1.id,
        text: 'Maythee run part 2',
        createdAt: BASE_TIME + MINUTE
      })
      const openedReply = createMockNote({
        id: 'https://activities.local/users/bob/statuses/opened-veer-reply',
        actor: mockBob,
        actorId: mockBob.id,
        reply: m2.id,
        text: 'Veer opens their reply here',
        createdAt: BASE_TIME + 2 * MINUTE
      })
      return { m1, m2, openedReply }
    }

    it('groups another author’s ancestors into a run with a "Replying to" line and the opened-row marker when opening their reply', () => {
      const { m1, m2, openedReply } = makeAncestorRunWithOpenedReply()

      render(
        <StatusThread
          host={host}
          status={openedReply}
          ancestors={[m1, m2]}
          descendants={[]}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )

      const run = screen.getByTestId('self-thread-run')
      expect(run).toHaveTextContent('Maythee run part 1')
      expect(run).toHaveTextContent('Maythee run part 2')
      expect(
        within(run).getByRole('button', { name: /Open part 2 of 2/i })
      ).toBeInTheDocument()

      // The line above the opened post's header links to the part it answers.
      // The label sits inside the link, so match the line by its full text.
      const replyingToLine = screen.getByText(
        (_, element) =>
          element?.textContent === 'Replying to Alice Smith · 2 of 2'
      )
      expect(replyingToLine).toBeInTheDocument()
      const partLink = within(replyingToLine).getByRole('link', {
        name: 'Part 2 of 2 by Alice Smith'
      })
      expect(partLink).toHaveAttribute('href', `#${m2.id}`)
      expect(document.getElementById(m2.id)).toBe(
        screen.getByTestId(`status-${m2.id}`)
      )

      // The opened post is the page's one marked row; the run above is not.
      const openedRow = screen.getByTestId(`status-${openedReply.id}`)
      expect(openedRow).toHaveAttribute('aria-current', 'location')
      expect(openedRow).toHaveClass('border-l-primary')
      expect(document.querySelectorAll('[aria-current]')).toHaveLength(1)
    })

    it('drops the "i of n" from the "Replying to" line when earlier ancestors were not loaded', () => {
      const { m1, m2, openedReply } = makeAncestorRunWithOpenedReply()

      render(
        <StatusThread
          host={host}
          status={openedReply}
          ancestors={[m1, m2]}
          descendants={[]}
          hasMoreAncestors
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )

      const replyingToLine = screen.getByText(
        (_, element) => element?.textContent === 'Replying to Alice Smith'
      )
      expect(replyingToLine).toBeInTheDocument()
      const nameLink = within(replyingToLine).getByRole('link', {
        name: 'Post by Alice Smith'
      })
      expect(nameLink).toHaveAttribute('href', `#${m2.id}`)
      expect(
        screen.queryByText(
          (_, element) =>
            element?.textContent === 'Replying to Alice Smith · 2 of 2'
        )
      ).toBeNull()
    })

    it('shows the "Replying to" line above the focused run when the opened post is part of it', () => {
      const { m1, m2, openedReply } = makeAncestorRunWithOpenedReply()
      const veerPart2 = createMockNote({
        id: 'https://activities.local/users/bob/statuses/veer-run-part-2',
        actor: mockBob,
        actorId: mockBob.id,
        reply: openedReply.id,
        text: 'Veer continues their own run',
        createdAt: BASE_TIME + 3 * MINUTE
      })

      render(
        <StatusThread
          host={host}
          status={openedReply}
          ancestors={[m1, m2]}
          descendants={[veerPart2]}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )

      // The ancestor run above, and the focused run holding the opened post.
      const runs = screen.getAllByTestId('self-thread-run')
      expect(runs).toHaveLength(2)
      const focusedRun = runs[1]
      expect(focusedRun).toHaveTextContent('Veer opens their reply here')

      const replyingToLine = within(focusedRun).getByText(
        (_, element) =>
          element?.textContent === 'Replying to Alice Smith · 2 of 2'
      )
      const partLink = within(replyingToLine).getByRole('link', {
        name: 'Part 2 of 2 by Alice Smith'
      })
      expect(partLink).toHaveAttribute('href', `#${m2.id}`)

      // The line sits above the focused run's part 1 header, so above the
      // opened part's own text.
      const openedPart = within(focusedRun).getByTestId(
        `status-${openedReply.id}`
      )
      const openedText = within(openedPart).getByText(
        'Veer opens their reply here'
      )
      expect(
        replyingToLine.compareDocumentPosition(openedText) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()

      // The opened part stays the page's one marked row.
      expect(openedPart).toHaveAttribute('aria-current', 'location')
      expect(document.querySelectorAll('[aria-current]')).toHaveLength(1)
    })

    it('links the "Replying to" line to the plain ancestor row after "Show as separate posts" splits the run', async () => {
      const { m1, m2, openedReply } = makeAncestorRunWithOpenedReply()

      render(
        <StatusThread
          host={host}
          status={openedReply}
          ancestors={[m1, m2]}
          descendants={[]}
          currentActor={mockBob}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )

      expect(
        screen.getByText(
          (_, element) =>
            element?.textContent === 'Replying to Alice Smith · 2 of 2'
        )
      ).toBeInTheDocument()

      fireEvent.keyDown(
        within(screen.getByTestId(`status-${m1.id}`)).getByRole('button', {
          name: /^More actions/
        }),
        { key: 'ArrowDown' }
      )
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Show as separate posts' })
      )

      await waitFor(() =>
        expect(screen.queryByTestId('self-thread-run')).not.toBeInTheDocument()
      )

      // The run no longer renders as a run, so its "2 of 2" numbering is
      // gone: the name alone links to the part's plain row.
      const replyingToLine = screen.getByText(
        (_, element) => element?.textContent === 'Replying to Alice Smith'
      )
      const nameLink = within(replyingToLine).getByRole('link', {
        name: 'Post by Alice Smith'
      })
      expect(nameLink).toHaveAttribute('href', `#${m2.id}`)
      expect(document.getElementById(m2.id)).toBe(
        screen.getByTestId(`status-${m2.id}`)
      )
      expect(
        screen.queryByText(
          (_, element) =>
            element?.textContent === 'Replying to Alice Smith · 2 of 2'
        )
      ).toBeNull()
    })

    it('falls back to the actor id handle when the answered part’s actor is missing', () => {
      const m1 = createMockNote({
        id: 'https://activities.local/users/maythee/statuses/no-actor-m1',
        actor: mockAlice,
        actorId: 'https://activities.local/users/maythee',
        text: 'Maythee run part 1',
        createdAt: BASE_TIME
      })
      const m2 = createMockNote({
        id: 'https://activities.local/users/maythee/statuses/no-actor-m2',
        actor: null,
        actorId: 'https://activities.local/users/maythee',
        url: 'https://activities.local/users/maythee/statuses/no-actor-m2',
        reply: m1.id,
        text: 'Maythee run part 2',
        createdAt: BASE_TIME + MINUTE
      })
      const openedReply = createMockNote({
        id: 'https://activities.local/users/bob/statuses/opened-veer-reply-3',
        actor: mockBob,
        actorId: mockBob.id,
        reply: m2.id,
        text: 'Veer opens their reply here',
        createdAt: BASE_TIME + 2 * MINUTE
      })

      render(
        <StatusThread
          host={host}
          status={openedReply}
          ancestors={[m1, m2]}
          descendants={[]}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )

      const replyingToLine = screen.getByText(
        (_, element) =>
          element?.textContent ===
          'Replying to @maythee@activities.local · 2 of 2'
      )
      const partLink = within(replyingToLine).getByRole('link', {
        name: 'Part 2 of 2 by @maythee@activities.local'
      })
      expect(partLink).toHaveAttribute('href', `#${m2.id}`)
    })

    it('keeps the answered part of a long ancestor run visible without marking it', () => {
      const parts = Array.from({ length: 8 }, (_, index) =>
        createMockNote({
          id: `https://activities.local/users/maythee/statuses/long-${index + 1}`,
          actor: mockAlice,
          actorId: mockAlice.id,
          reply:
            index === 0
              ? ''
              : `https://activities.local/users/maythee/statuses/long-${index}`,
          text: `Long run part ${index + 1}`,
          createdAt: BASE_TIME + index * MINUTE
        })
      )
      const openedReply = createMockNote({
        id: 'https://activities.local/users/bob/statuses/reply-to-long-part-4',
        actor: mockBob,
        actorId: mockBob.id,
        reply: parts[3].id,
        text: 'Veer answers part 4',
        createdAt: BASE_TIME + 8 * MINUTE
      })

      render(
        <StatusThread
          host={host}
          status={openedReply}
          ancestors={parts}
          descendants={[]}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )

      // The run folds around the answered part: part 4 stays visible.
      expect(
        screen.getByRole('button', { name: /Open part 4 of 8/i })
      ).toBeInTheDocument()
      expect(
        screen.getByText('Show 1 more post in this thread')
      ).toBeInTheDocument()
      expect(
        screen.getByText('Show 3 more posts in this thread')
      ).toBeInTheDocument()
      const answeredPart = screen.getByTestId(`status-${parts[3].id}`)
      expect(answeredPart).not.toHaveAttribute('aria-current')
      expect(answeredPart.querySelector('.border-l-primary')).toBeNull()
      // Only the opened post is marked.
      expect(document.querySelectorAll('[aria-current]')).toHaveLength(1)
      expect(screen.getByTestId(`status-${openedReply.id}`)).toHaveAttribute(
        'aria-current',
        'location'
      )
    })

    it('marks the opened run part as the page’s one location when opening one’s own post', () => {
      const [a1, a2] = makeAliceRun(2)

      render(
        <StatusThread
          host={host}
          status={a2}
          ancestors={[a1]}
          descendants={[]}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )

      expect(document.querySelectorAll('[aria-current]')).toHaveLength(1)
      expect(screen.getByTestId(`status-${a2.id}`)).toHaveAttribute(
        'aria-current',
        'location'
      )
    })

    it('leaves a lone opened post unmarked: no ancestors above, no tint', () => {
      const lone = createMockNote({
        id: 'https://activities.local/users/bob/statuses/lone-post',
        actor: mockBob,
        actorId: mockBob.id,
        text: 'A lone post with nothing above it',
        createdAt: BASE_TIME
      })

      render(
        <StatusThread
          host={host}
          status={lone}
          ancestors={[]}
          descendants={[]}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )

      const openedRow = screen.getByTestId(`status-${lone.id}`)
      expect(openedRow).not.toHaveAttribute('aria-current')
      expect(openedRow).not.toHaveClass('border-l-primary')
      expect(document.querySelectorAll('[aria-current]')).toHaveLength(0)
    })

    it('hides the Replies section when every loaded reply nests under an ancestor run', () => {
      const { m1, m2, outsideReply } = makeAncestorRunWithOutsideReply()
      const openedReply = createMockNote({
        id: 'https://activities.local/users/bob/statuses/opened-veer-reply-2',
        actor: mockBob,
        actorId: mockBob.id,
        reply: m2.id,
        text: 'Veer opens their reply here',
        createdAt: BASE_TIME + 2 * MINUTE
      })

      render(
        <StatusThread
          host={host}
          status={openedReply}
          ancestors={[m1, m2]}
          descendants={[outsideReply]}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )

      expectReplyUnderAncestorRun()
      expect(screen.queryByTestId('thread-descendants')).not.toBeInTheDocument()
      expect(screen.queryByText(/^Replies \(/)).not.toBeInTheDocument()
    })

    it('counts only the replies that render in the Replies section, not the ones nested under an ancestor run', () => {
      const { m1, m2, outsideReply } = makeAncestorRunWithOutsideReply()
      const openedReply = createMockNote({
        id: 'https://activities.local/users/bob/statuses/opened-veer-reply-3',
        actor: mockBob,
        actorId: mockBob.id,
        reply: m2.id,
        text: 'Veer opens their reply here',
        createdAt: BASE_TIME + 2 * MINUTE
      })
      const directReply = createMockNote({
        id: 'https://activities.local/users/dave/statuses/direct-reply',
        actor: mockDave,
        actorId: mockDave.id,
        reply: openedReply.id,
        text: 'Dave replies to the opened post',
        createdAt: BASE_TIME + 5 * MINUTE
      })

      render(
        <StatusThread
          host={host}
          status={openedReply}
          ancestors={[m1, m2]}
          descendants={[outsideReply, directReply]}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )

      const repliesSection = screen.getByTestId('thread-descendants')
      expect(repliesSection).toHaveTextContent('Replies (1)')
      expect(repliesSection).toHaveTextContent(
        'Dave replies to the opened post'
      )
      expect(repliesSection).not.toHaveTextContent('Carol replies to part 2')
    })

    it('renders a tucked reply inside the run as an inset card', () => {
      const [a1, a2] = makeAliceRun(2)
      const bobInset = createMockNote({
        id: 'https://activities.local/users/bob/statuses/bob-inset',
        actor: mockBob,
        actorId: mockBob.id,
        reply: a1.id,
        text: 'Quick plain reply from Bob',
        createdAt: BASE_TIME + MINUTE
      })

      render(
        <StatusThread
          host={host}
          status={a1}
          ancestors={[]}
          descendants={[bobInset, a2]}
          currentActor={mockAlice}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )

      const insetGroup = screen.getByRole('group', {
        name: 'Reply by Bob Jones'
      })
      expect(screen.getByTestId('self-thread-run')).toContainElement(insetGroup)
      expect(insetGroup).toHaveTextContent('Quick plain reply from Bob')
      // Tucked reply is excluded from Replies section below
      expect(screen.queryByTestId('thread-descendants')).not.toBeInTheDocument()
    })

    it('opens the reply composer for a tucked reply inside the run', async () => {
      const [a1, a2] = makeAliceRun(2)
      const bobInset = createMockNote({
        id: 'https://activities.local/users/bob/statuses/bob-inset',
        actor: mockBob,
        actorId: mockBob.id,
        reply: a1.id,
        text: 'Quick plain reply from Bob',
        createdAt: BASE_TIME + MINUTE
      })

      render(
        <StatusThread
          host={host}
          status={a1}
          ancestors={[]}
          descendants={[bobInset, a2]}
          currentActor={mockAlice}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )

      fireEvent.click(
        within(
          screen.getByRole('group', { name: 'Reply by Bob Jones' })
        ).getByRole('button', { name: /^Reply to Bob Jones/ })
      )

      expect(
        await screen.findByPlaceholderText(/Reply to Bob/i)
      ).toBeInTheDocument()
    })

    it('keeps an untucked reply with media under Replies (1) with "Replying to 1 of 3" without splitting the run', () => {
      const [a1, a2, a3] = makeAliceRun(3)
      const bobBase = createMockNote({
        id: 'https://activities.local/users/bob/statuses/bob-photo',
        actor: mockBob,
        actorId: mockBob.id,
        reply: a1.id,
        text: 'Bob reply with photo to part 1',
        createdAt: BASE_TIME + MINUTE
      })
      const bobWithPhoto = {
        ...bobBase,
        attachments: [createMockPhoto(bobBase, 'bob-pic')]
      }

      render(
        <StatusThread
          host={host}
          status={a1}
          ancestors={[]}
          descendants={[bobWithPhoto, a2, a3]}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )

      // All 3 parts remain in the single run
      const runEl = screen.getByTestId('self-thread-run')
      expect(runEl).toHaveTextContent('Run part 1 content')
      expect(runEl).toHaveTextContent('Run part 2 content')
      expect(runEl).toHaveTextContent('Run part 3 content')

      // Bob's photo reply is in Replies (1) with "Replying to 1 of 3"
      const descendantsSection = screen.getByTestId('thread-descendants')
      expect(descendantsSection).toHaveTextContent('Replies (1)')
      expect(descendantsSection).toHaveTextContent('Replying to 1 of 3')
      expect(descendantsSection).toHaveTextContent(
        'Bob reply with photo to part 1'
      )
    })

    it('hides "No replies yet" when opening part 1 whose only descendants are merged self-replies', () => {
      const [a1, a2, a3] = makeAliceRun(3)

      render(
        <StatusThread
          host={host}
          status={a1}
          ancestors={[]}
          descendants={[a2, a3]}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )

      expect(screen.queryByText('No replies yet')).not.toBeInTheDocument()
    })

    it('excludes posts merged into the run from the "Replies (N)" count', () => {
      const [a1, a2, a3] = makeAliceRun(3)
      const bobInset = createMockNote({
        id: 'https://activities.local/users/bob/statuses/bob-inset',
        actor: mockBob,
        actorId: mockBob.id,
        reply: a1.id,
        text: 'Bob tucked reply',
        createdAt: BASE_TIME + MINUTE
      })
      const carolReplyToEnd = createMockNote({
        id: 'https://activities.local/users/carol/statuses/carol-end',
        actor: mockCarol,
        actorId: mockCarol.id,
        reply: a3.id,
        text: 'Carol reply at end',
        createdAt: BASE_TIME + 6 * MINUTE
      })

      render(
        <StatusThread
          host={host}
          status={a1}
          ancestors={[]}
          descendants={[bobInset, a2, a3, carolReplyToEnd]}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )

      expect(screen.getByText('Replies (1)')).toBeInTheDocument()
    })

    it('restores separate ancestor, focused, and descendant rows when clicking "Show as separate posts" in part 1 menu', async () => {
      const [a1, a2, a3] = makeAliceRun(3)

      const { rerender } = render(
        <StatusThread
          host={host}
          status={a2}
          ancestors={[a1]}
          descendants={[a3]}
          currentActor={mockAlice}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )

      expect(screen.getByTestId('self-thread-run')).toBeInTheDocument()
      expect(screen.queryByTestId('thread-ancestors')).not.toBeInTheDocument()

      const part1Trigger = within(
        screen.getByTestId(`status-${a1.id}`)
      ).getByRole('button', { name: 'More actions' })
      fireEvent.keyDown(part1Trigger, { key: 'ArrowDown' })
      fireEvent.click(
        await screen.findByRole('menuitem', {
          name: 'Show as separate posts'
        })
      )
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
      await waitFor(() =>
        expect(screen.queryByTestId('self-thread-run')).not.toBeInTheDocument()
      )

      expect(screen.getByTestId('thread-ancestors')).toHaveTextContent(
        'Run part 1 content'
      )
      expect(screen.getByTestId('focused-status')).toHaveTextContent(
        'Run part 2 content'
      )
      expect(screen.getByTestId('thread-descendants')).toHaveTextContent(
        'Run part 3 content'
      )
      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getByTestId(`status-${a1.id}`)
        )
      )

      // Separating persists by status IDs even when the run's first post (and run.key) changes
      rerender(
        <StatusThread
          host={host}
          status={a2}
          ancestors={[]}
          descendants={[a3]}
          currentActor={mockAlice}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )
      expect(screen.queryByTestId('self-thread-run')).not.toBeInTheDocument()
      expect(screen.getByTestId('focused-status')).toHaveTextContent(
        'Run part 2 content'
      )
      expect(screen.getByTestId('thread-descendants')).toHaveTextContent(
        'Run part 3 content'
      )
    })

    it('collapses middle parts of a long run (> 6 parts) with two hidden gaps each showing their own button and expands all on click', () => {
      const parts = makeAliceRun(9)
      const focused = parts[4] // Part 5 (index 4)
      const ancestors = parts.slice(0, 4)
      const descendants = parts.slice(5)

      render(
        <StatusThread
          host={host}
          status={focused}
          ancestors={ancestors}
          descendants={descendants}
          currentTime={BASE_TIME + 30 * MINUTE}
        />
      )

      // Visible before expanding: part 1, part 2, opened part 5, last part 9
      expect(screen.getByText('Run part 1 content')).toBeInTheDocument()
      expect(screen.getByText('Run part 2 content')).toBeInTheDocument()
      expect(screen.queryByText('Run part 3 content')).not.toBeInTheDocument()
      expect(screen.queryByText('Run part 4 content')).not.toBeInTheDocument()
      expect(screen.getByText('Run part 5 content')).toBeInTheDocument()
      expect(screen.queryByText('Run part 6 content')).not.toBeInTheDocument()
      expect(screen.queryByText('Run part 7 content')).not.toBeInTheDocument()
      expect(screen.queryByText('Run part 8 content')).not.toBeInTheDocument()
      expect(screen.getByText('Run part 9 content')).toBeInTheDocument()

      // First gap hides parts 3-4 (2 posts); second gap hides parts 6-8 (3 posts)
      expect(screen.getAllByTestId('self-thread-collapse-row')).toHaveLength(2)
      const firstGapBtn = screen.getByRole('button', {
        name: 'Show 2 more posts in this thread'
      })
      const secondGapBtn = screen.getByRole('button', {
        name: 'Show 3 more posts in this thread'
      })
      expect(firstGapBtn).toBeInTheDocument()
      expect(secondGapBtn).toBeInTheDocument()

      fireEvent.click(secondGapBtn)

      // The clicked button unmounts: focus goes to the first part it revealed.
      expect(document.activeElement).toBe(
        screen.getByTestId(`status-${parts[5].id}`)
      )

      for (let i = 1; i <= 9; i++) {
        expect(screen.getByText(`Run part ${i} content`)).toBeInTheDocument()
      }
      expect(
        screen.queryByRole('button', {
          name: /Show .* more posts in this thread/i
        })
      ).not.toBeInTheDocument()
    })

    it('opens the inline composer inside the run under the targeted part when clicking Reply on a run part', () => {
      const [a1, a2, a3] = makeAliceRun(3)

      render(
        <StatusThread
          host={host}
          status={a3}
          ancestors={[a1, a2]}
          descendants={[]}
          currentActor={mockAlice}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )

      const part2El = screen.getByTestId(`status-${a2.id}`)
      const replyBtn = within(part2El).getByRole('button', { name: /Reply/i })
      fireEvent.click(replyBtn)

      const composer = screen.getByPlaceholderText(/Reply to Alice/i)
      expect(screen.getByTestId('self-thread-run')).toContainElement(composer)
      expect(part2El).toContainElement(composer)
    })

    it('renders per-part ReadOnlyStats for a signed-out viewer', () => {
      const [base1, base2, base3] = makeAliceRun(3)
      const a1 = { ...base1, totalShares: 2, totalLikes: 3 }
      const a2 = { ...base2, totalShares: 1, totalLikes: 5 }
      const a3 = { ...base3, totalShares: 0, totalLikes: 4 }

      render(
        <StatusThread
          host={host}
          status={a3}
          ancestors={[a1, a2]}
          descendants={[]}
          currentActor={null}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )

      expect(
        screen.queryByRole('group', { name: 'Post actions' })
      ).not.toBeInTheDocument()

      const engagementRows = screen.getAllByRole('group', {
        name: 'Engagement'
      })
      expect(engagementRows).toHaveLength(3)
      expect(screen.getByTestId(`status-${a1.id}`)).toContainElement(
        engagementRows[0]
      )
      expect(
        within(engagementRows[0]).getByTitle('3 likes')
      ).toBeInTheDocument()
      expect(screen.getByTestId(`status-${a2.id}`)).toContainElement(
        engagementRows[1]
      )
      expect(
        within(engagementRows[1]).getByTitle('5 likes')
      ).toBeInTheDocument()
      expect(screen.getByTestId(`status-${a3.id}`)).toContainElement(
        engagementRows[2]
      )
      expect(
        within(engagementRows[2]).getByTitle('4 likes')
      ).toBeInTheDocument()
    })

    it("does not clamp run parts while clamping another person's long ancestor post", () => {
      mockClampCollapsible = true
      const bobLongAncestor = createMockNote({
        id: 'https://activities.local/users/bob/statuses/bob-long',
        actor: mockBob,
        actorId: mockBob.id,
        text: 'Bob very long ancestor post content. '.repeat(12),
        createdAt: BASE_TIME
      })
      const a1 = createMockNote({
        id: 'https://activities.local/users/alice/statuses/a1-long',
        actor: mockAlice,
        actorId: mockAlice.id,
        reply: bobLongAncestor.id,
        text: 'Alice very long first run part content. '.repeat(12),
        createdAt: BASE_TIME + MINUTE
      })
      const a2 = createMockNote({
        id: 'https://activities.local/users/alice/statuses/a2-long',
        actor: mockAlice,
        actorId: mockAlice.id,
        reply: a1.id,
        text: 'Alice very long second run part content. '.repeat(12),
        createdAt: BASE_TIME + 2 * MINUTE
      })

      render(
        <StatusThread
          host={host}
          status={a2}
          ancestors={[bobLongAncestor, a1]}
          descendants={[]}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )

      const ancestorRow = screen.getByTestId('ancestor-status')
      expect(
        within(ancestorRow).getByRole('button', { name: 'Show more content' })
      ).toBeInTheDocument()

      const runEl = screen.getByTestId('self-thread-run')
      expect(
        within(runEl).queryByRole('button', { name: 'Show more content' })
      ).not.toBeInTheDocument()
    })

    it('does not clamp a long tucked reply inside the run', () => {
      mockClampCollapsible = true
      const [a1, a2] = makeAliceRun(2)
      const bobInset = createMockNote({
        id: 'https://activities.local/users/bob/statuses/bob-long-inset',
        actor: mockBob,
        actorId: mockBob.id,
        reply: a1.id,
        text: 'Bob very long tucked reply content. '.repeat(12),
        createdAt: BASE_TIME + MINUTE
      })

      render(
        <StatusThread
          host={host}
          status={a1}
          ancestors={[]}
          descendants={[bobInset, a2]}
          currentActor={mockAlice}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )

      const insetGroup = screen.getByRole('group', {
        name: 'Reply by Bob Jones'
      })
      expect(insetGroup).toHaveTextContent('Bob very long tucked reply')
      expect(
        within(insetGroup).queryByRole('button', { name: 'Show more content' })
      ).not.toBeInTheDocument()
    })

    describe('runs above and below the opened post', () => {
      it('nests a reply created on a part of an earlier run without an "unavailable" boundary, and never scrolls or marks the earlier run as opened', async () => {
        const { a1, a2, a3, a4 } = makeTwoRuns()
        const reply = createMockNote({
          id: 'https://activities.local/users/bob/statuses/reply-to-earlier-part',
          actor: mockBob,
          actorId: mockBob.id,
          reply: a2.id,
          text: 'Reply to the earlier run',
          createdAt: BASE_TIME + 30 * MINUTE
        })
        mockCreateNote.mockResolvedValueOnce({ status: reply, attachments: [] })
        const scrollIntoView = vi.fn()
        Element.prototype.scrollIntoView = scrollIntoView

        try {
          render(
            <StatusThread
              host={host}
              status={a3}
              ancestors={[a1, a2]}
              descendants={[a4]}
              currentActor={mockBob}
              currentTime={BASE_TIME + 40 * MINUTE}
            />
          )

          const runs = screen.getAllByTestId('self-thread-run')
          expect(runs).toHaveLength(2)
          // Only the focused run has an opened part; the earlier run has none.
          expect(runs[0].querySelector('[aria-current]')).toBeNull()
          expect(runs[1].querySelector('[aria-current="location"]')).not.toBe(
            null
          )
          // Part 1 of the focused run is opened: nothing to scroll to.
          expect(scrollIntoView).not.toHaveBeenCalled()

          fireEvent.click(
            within(screen.getByTestId(`status-${a2.id}`)).getByRole('button', {
              name: /Reply/i
            })
          )
          fireEvent.change(screen.getByPlaceholderText(/Reply to Alice/i), {
            target: { value: 'Reply to the earlier run' }
          })
          fireEvent.click(screen.getByRole('button', { name: 'Post' }))

          await waitFor(() => expect(mockCreateNote).toHaveBeenCalled())
          // The reply nests under the earlier run's row, not under the opened
          // post's Replies section.
          // The reply nests under the earlier run's row and is not counted
          // under the opened post's "Replies", so the section hides.
          await waitFor(() =>
            expect(
              within(screen.getByTestId('ancestor-status')).getByText(
                'Reply to the earlier run'
              )
            ).toBeInTheDocument()
          )
          expect(
            screen.queryByTestId('thread-descendants')
          ).not.toBeInTheDocument()
          expect(
            screen.queryByTestId('parent-unavailable-boundary')
          ).not.toBeInTheDocument()
        } finally {
          Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
        }
      })

      it('moves focus into a later run after "Show as separate posts" on it, and offers the item on part 1 only', async () => {
        const { a1, a3, a4 } = makeTwoRuns()
        const a2 = makeAliceRun(2)[1]

        render(
          <StatusThread
            host={host}
            status={a1}
            ancestors={[]}
            descendants={[a2, a3, a4]}
            currentActor={mockAlice}
            currentTime={BASE_TIME + 40 * MINUTE}
          />
        )

        const runs = screen.getAllByTestId('self-thread-run')
        expect(runs).toHaveLength(2)
        // The later run is below the opened post: no opened part.
        expect(runs[1].querySelector('[aria-current]')).toBeNull()

        // Part 2 of the later run does not offer "Show as separate posts".
        fireEvent.keyDown(
          within(screen.getByTestId(`status-${a4.id}`)).getByRole('button', {
            name: 'More actions'
          }),
          { key: 'ArrowDown' }
        )
        await screen.findByRole('menu')
        expect(
          screen.queryByRole('menuitem', { name: 'Show as separate posts' })
        ).not.toBeInTheDocument()
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

        fireEvent.keyDown(
          within(screen.getByTestId(`status-${a3.id}`)).getByRole('button', {
            name: 'More actions'
          }),
          { key: 'ArrowDown' }
        )
        fireEvent.click(
          await screen.findByRole('menuitem', {
            name: 'Show as separate posts'
          })
        )
        await waitFor(() =>
          expect(screen.getAllByTestId('self-thread-run')).toHaveLength(1)
        )

        await waitFor(() =>
          expect(document.activeElement).toHaveAttribute('data-node-id', a3.id)
        )
      })
    })

    const openPostMenu = (statusId: string) =>
      fireEvent.keyDown(
        within(screen.getByTestId(`status-${statusId}`)).getByRole('button', {
          name: /^More actions/
        }),
        { key: 'ArrowDown' }
      )

    describe('deleting a post', () => {
      const deleteCases = () => {
        const [a1, a2, a3] = makeAliceRun(3)
        const bobRoot = createMockNote({
          id: 'https://activities.local/users/bob/statuses/bob-root',
          actor: mockBob,
          actorId: mockBob.id,
          text: 'Bob root',
          createdAt: BASE_TIME
        })
        const aliceReply = createMockNote({
          id: 'https://activities.local/users/alice/statuses/alice-reply',
          actor: mockAlice,
          actorId: mockAlice.id,
          reply: bobRoot.id,
          text: 'Alice reply to root',
          createdAt: BASE_TIME + MINUTE
        })
        const bobInset = createMockNote({
          id: 'https://activities.local/users/bob/statuses/bob-inset',
          actor: mockBob,
          actorId: mockBob.id,
          reply: a1.id,
          text: 'Bob tucked reply',
          createdAt: BASE_TIME + MINUTE
        })
        const bobReply = createMockNote({
          id: 'https://activities.local/users/bob/statuses/bob-plain',
          actor: mockBob,
          actorId: mockBob.id,
          reply: aliceReply.id,
          text: 'Bob plain reply',
          createdAt: BASE_TIME + 30 * MINUTE
        })
        return [
          {
            name: 'part of the opened run below the opened post',
            props: {
              status: a1,
              descendants: [a2, a3],
              currentActor: mockAlice
            },
            deleted: a3,
            text: 'Run part 3 content'
          },
          {
            name: 'part of the opened run above the opened post',
            props: {
              status: a3,
              ancestors: [a1, a2],
              currentActor: mockAlice
            },
            deleted: a2,
            text: 'Run part 2 content'
          },
          {
            name: 'reply under the thread',
            props: {
              status: aliceReply,
              ancestors: [bobRoot],
              descendants: [bobReply],
              currentActor: mockBob
            },
            deleted: bobReply,
            text: 'Bob plain reply'
          },
          {
            name: 'ancestor above the thread',
            props: {
              status: aliceReply,
              ancestors: [bobRoot],
              currentActor: mockBob
            },
            deleted: bobRoot,
            text: 'Bob root'
          },
          {
            name: 'tucked reply inside the run',
            props: {
              status: a1,
              descendants: [bobInset, a2],
              currentActor: mockBob
            },
            deleted: bobInset,
            text: 'Bob tucked reply'
          }
        ]
      }

      it.each(deleteCases())(
        'drops a deleted $name',
        async ({ props, deleted, text }) => {
          mockDeleteStatus.mockResolvedValue(true)
          render(
            <StatusThread
              host={host}
              currentTime={BASE_TIME + 40 * MINUTE}
              {...props}
            />
          )
          expect(screen.getByText(text)).toBeInTheDocument()

          openPostMenu(deleted.id)
          fireEvent.click(
            await screen.findByRole('menuitem', { name: 'Delete post' })
          )
          fireEvent.click(
            within(await screen.findByRole('dialog')).getByRole('button', {
              name: 'Delete'
            })
          )

          await waitFor(() => expect(screen.queryByText(text)).toBeNull())
          expect(mockDeleteStatus).toHaveBeenCalledWith({
            statusId: deleted.id
          })
        }
      )
    })

    describe('replying to a part of the run', () => {
      const replyOnPart = async (target: Status, reply: Status) => {
        mockCreateNote.mockResolvedValueOnce({ status: reply, attachments: [] })
        fireEvent.click(
          within(screen.getByTestId(`status-${target.id}`)).getByRole(
            'button',
            { name: /Reply/i }
          )
        )
        fireEvent.change(screen.getByPlaceholderText(/Reply to Alice/i), {
          target: { value: 'Reply text' }
        })
        fireEvent.click(screen.getByRole('button', { name: 'Post' }))
        await waitFor(() => expect(mockCreateNote).toHaveBeenCalled())
      }

      const bobLateReplyTo = (parent: Status) =>
        createMockNote({
          id: 'https://activities.local/users/bob/statuses/late-reply',
          actor: mockBob,
          actorId: mockBob.id,
          reply: parent.id,
          text: 'Reply to a part of the run',
          createdAt: BASE_TIME + 60 * MINUTE
        })

      it.each([
        { part: 'second', index: 1 },
        { part: 'last', index: 2 }
      ])(
        'nests a reply to the $part part of the opened run without an "unavailable" boundary',
        async ({ index }) => {
          const parts = makeAliceRun(3)
          const reply = bobLateReplyTo(parts[index])

          render(
            <StatusThread
              host={host}
              status={parts[0]}
              descendants={[parts[1], parts[2]]}
              currentActor={mockBob}
              currentTime={BASE_TIME + 90 * MINUTE}
            />
          )
          await replyOnPart(parts[index], reply)

          expect(
            await screen.findByText('Reply to a part of the run')
          ).toBeInTheDocument()
          expect(
            screen.queryByTestId('parent-unavailable-boundary')
          ).not.toBeInTheDocument()
        }
      )

      it('nests a reply to a part of a later run without an "unavailable" boundary', async () => {
        const { a1, a2, a3, a4 } = makeTwoRuns()
        const reply = bobLateReplyTo(a4)

        render(
          <StatusThread
            host={host}
            status={a1}
            descendants={[a2, a3, a4]}
            currentActor={mockBob}
            currentTime={BASE_TIME + 90 * MINUTE}
          />
        )
        await replyOnPart(a4, reply)

        expect(
          await screen.findByText('Reply to a part of the run')
        ).toBeInTheDocument()
        expect(
          screen.queryByTestId('parent-unavailable-boundary')
        ).not.toBeInTheDocument()
      })
    })

    it('nests a reply that points at a run part by its URL without an "unavailable" boundary', () => {
      const [a1, a2, a3] = makeAliceRun(3)
      const bobReply = createMockNote({
        id: 'https://activities.local/users/bob/statuses/url-reply',
        actor: mockBob,
        actorId: mockBob.id,
        reply: a2.url,
        text: 'Reply addressed by URL',
        createdAt: BASE_TIME + 60 * MINUTE
      })

      render(
        <StatusThread
          host={host}
          status={a1}
          descendants={[a2, a3, bobReply]}
          currentTime={BASE_TIME + 90 * MINUTE}
        />
      )

      expect(screen.getByText('Reply addressed by URL')).toBeInTheDocument()
      expect(
        screen.queryByTestId('parent-unavailable-boundary')
      ).not.toBeInTheDocument()
    })

    it('separates an earlier run from the thread when "Show as separate posts" is chosen on its first part', async () => {
      const { a1, a2, a3, a4 } = makeTwoRuns()

      render(
        <StatusThread
          host={host}
          status={a3}
          ancestors={[a1, a2]}
          descendants={[a4]}
          currentActor={mockAlice}
          currentTime={BASE_TIME + 40 * MINUTE}
        />
      )
      expect(screen.getAllByTestId('self-thread-run')).toHaveLength(2)

      openPostMenu(a1.id)
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Show as separate posts' })
      )

      await waitFor(() =>
        expect(screen.getAllByTestId('self-thread-run')).toHaveLength(1)
      )
      expect(screen.getByTestId('thread-ancestors')).toHaveTextContent(
        'Run part 1 content'
      )
    })

    it('drops "Replying to 1 of 3" once the run is separated into plain posts', async () => {
      const [a1, a2, a3] = makeAliceRun(3)
      const bobBase = createMockNote({
        id: 'https://activities.local/users/bob/statuses/bob-photo',
        actor: mockBob,
        actorId: mockBob.id,
        reply: a1.id,
        text: 'Bob reply with photo to part 1',
        createdAt: BASE_TIME + MINUTE
      })
      const bobWithPhoto = {
        ...bobBase,
        attachments: [createMockPhoto(bobBase, 'bob-pic')]
      }

      render(
        <StatusThread
          host={host}
          status={a1}
          descendants={[bobWithPhoto, a2, a3]}
          currentActor={mockAlice}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )
      expect(screen.getByText('Replying to 1 of 3')).toBeInTheDocument()

      openPostMenu(a1.id)
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Show as separate posts' })
      )

      await waitFor(() =>
        expect(screen.queryByTestId('self-thread-run')).not.toBeInTheDocument()
      )
      expect(screen.queryByText(/Replying to \d+ of \d+/)).toBeNull()
    })

    it.each([
      { action: 'Edit post', mode: 'edit' },
      { action: 'Quote post', mode: 'quote' }
    ])(
      'opens the $mode composer under the run part it was chosen on',
      async ({ action }) => {
        const [a1, a2, a3] = makeAliceRun(3)

        render(
          <StatusThread
            host={host}
            status={a3}
            ancestors={[a1, a2]}
            currentActor={mockAlice}
            currentTime={BASE_TIME + 10 * MINUTE}
          />
        )

        openPostMenu(a2.id)
        fireEvent.click(await screen.findByRole('menuitem', { name: action }))

        const part2 = screen.getByTestId(`status-${a2.id}`)
        expect(await within(part2).findByRole('textbox')).toBeInTheDocument()
        expect(
          within(screen.getByTestId(`status-${a3.id}`)).queryByRole('textbox')
        ).toBeNull()
      }
    )

    it('closes the composer and refreshes once a quote of a run part is posted', async () => {
      const [a1, a2, a3] = makeAliceRun(3)
      mockCreateNote.mockResolvedValueOnce({ status: a3, attachments: [] })

      render(
        <StatusThread
          host={host}
          status={a3}
          ancestors={[a1, a2]}
          currentActor={mockAlice}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )

      openPostMenu(a2.id)
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Quote post' })
      )
      const part2 = screen.getByTestId(`status-${a2.id}`)
      fireEvent.change(await within(part2).findByRole('textbox'), {
        target: { value: 'Quoting this part' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))

      await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1))
      expect(within(part2).queryByRole('textbox')).toBeNull()
    })

    it('closes the composer and refreshes once an edit of a run part is saved', async () => {
      const [a1, a2, a3] = makeAliceRun(3)
      mockUpdateNote.mockResolvedValueOnce({
        content: 'edited',
        status: {
          id: a2.id,
          text: 'edited',
          reply: a2.reply,
          createdAt: a2.createdAt,
          updatedAt: a2.createdAt + MINUTE
        },
        spoilerText: '',
        mediaAttachments: []
      })

      render(
        <StatusThread
          host={host}
          status={a3}
          ancestors={[a1, a2]}
          currentActor={mockAlice}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )

      openPostMenu(a2.id)
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Edit post' })
      )
      const part2 = screen.getByTestId(`status-${a2.id}`)
      fireEvent.change(await within(part2).findByRole('textbox'), {
        target: { value: 'edited' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Update' }))

      await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1))
      expect(within(part2).queryByRole('textbox')).toBeNull()
    })

    it('tints the opened part and its left edge, reaching up through the card padding only for part 1', () => {
      const [a1, a2, a3] = makeAliceRun(3)

      const first = render(
        <StatusThread
          host={host}
          status={a1}
          ancestors={[]}
          descendants={[a2, a3]}
          currentActor={mockAlice}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )
      const openedFirst = screen.getByTestId(`status-${a1.id}`)
      expect(openedFirst).toHaveClass('border-l-primary', 'bg-primary/[0.07]')
      expect(openedFirst).toHaveClass('-mt-4')
      first.unmount()

      render(
        <StatusThread
          host={host}
          status={a2}
          ancestors={[a1]}
          descendants={[a3]}
          currentActor={mockAlice}
          currentTime={BASE_TIME + 10 * MINUTE}
        />
      )
      const openedMiddle = screen.getByTestId(`status-${a2.id}`)
      expect(openedMiddle).toHaveClass('border-l-primary', 'bg-primary/[0.07]')
      expect(openedMiddle).not.toHaveClass('-mt-4')
      expect(screen.getByTestId(`status-${a1.id}`)).not.toHaveClass(
        'border-l-primary'
      )
    })

    it('does not scroll when the opened post is part 1 of the run', () => {
      const [a1, a2, a3] = makeAliceRun(3)
      const scrollIntoView = vi.fn()
      Element.prototype.scrollIntoView = scrollIntoView

      try {
        render(
          <StatusThread
            host={host}
            status={a1}
            ancestors={[]}
            descendants={[a2, a3]}
            currentActor={mockAlice}
            currentTime={BASE_TIME + 10 * MINUTE}
          />
        )
        expect(scrollIntoView).not.toHaveBeenCalled()
      } finally {
        Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
      }
    })

    it('renders a second self-reply block > 10 minutes later as its own SelfThreadRun with its own header', () => {
      const a1 = createMockNote({
        id: 'https://activities.local/users/alice/statuses/block1-1',
        actor: mockAlice,
        actorId: mockAlice.id,
        text: 'First block part 1',
        createdAt: BASE_TIME
      })
      const a2 = createMockNote({
        id: 'https://activities.local/users/alice/statuses/block1-2',
        actor: mockAlice,
        actorId: mockAlice.id,
        reply: a1.id,
        text: 'First block part 2',
        createdAt: BASE_TIME + 2 * MINUTE
      })
      const a3 = createMockNote({
        id: 'https://activities.local/users/alice/statuses/block2-1',
        actor: mockAlice,
        actorId: mockAlice.id,
        reply: a2.id,
        text: 'Second block part 1 after gap',
        createdAt: BASE_TIME + 20 * MINUTE
      })
      const a4 = createMockNote({
        id: 'https://activities.local/users/alice/statuses/block2-2',
        actor: mockAlice,
        actorId: mockAlice.id,
        reply: a3.id,
        text: 'Second block part 2 after gap',
        createdAt: BASE_TIME + 22 * MINUTE
      })

      render(
        <StatusThread
          host={host}
          status={a1}
          ancestors={[]}
          descendants={[a2, a3, a4]}
          currentActor={mockAlice}
          currentTime={BASE_TIME + 30 * MINUTE}
        />
      )

      const runs = screen.getAllByTestId('self-thread-run')
      expect(runs).toHaveLength(2)

      // First block has its own header time span (30m – 28m) and opened part a1
      expect(within(runs[0]).getByText('30m – 28m')).toBeInTheDocument()
      expect(within(runs[0]).getByTestId(`status-${a1.id}`)).toHaveAttribute(
        'aria-current',
        'location'
      )

      // Second block (>10 min later) has its own header time span (10m – 8m), its own 2 of 2 label, and no opened part
      expect(within(runs[1]).getByText('10m – 8m')).toBeInTheDocument()
      expect(
        within(runs[1]).getByText('Second block part 1 after gap')
      ).toBeInTheDocument()
      expect(
        within(runs[1]).getByRole('button', { name: /Open part 2 of 2/i })
      ).toBeInTheDocument()
      expect(runs[1].querySelector('[aria-current="location"]')).toBeNull()
      expect(screen.queryByTestId('thread-descendants')).not.toBeInTheDocument()
    })
  })
})
