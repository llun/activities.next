/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createNote } from '@/lib/client'
import {
  BASE_TIME,
  createMockNote,
  mockAlice,
  mockBob,
  mockCarol
} from '@/lib/components/posts/__fixtures__/timeline-context'
import { StatusThread } from '@/lib/components/posts/status-thread'

const mockPush = vi.fn()
const mockRefresh = vi.fn()

vi.mock('./collapsible-content', () => ({
  CollapsibleContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
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
    likeStatus: vi.fn(),
    undoLikeStatus: vi.fn(),
    getTranslationCapability: vi.fn().mockResolvedValue({ enabled: false }),
    getTranslationLanguages: vi.fn().mockResolvedValue([])
  }
})

const mockCreateNote = vi.mocked(createNote)

describe('StatusThread', () => {
  const host = 'activities.local'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders ancestors, focused status, and descendants in order', () => {
    const root = createMockNote({
      id: 'https://activities.local/users/alice/statuses/root',
      actor: mockAlice,
      actorId: mockAlice.id,
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
  })
})
