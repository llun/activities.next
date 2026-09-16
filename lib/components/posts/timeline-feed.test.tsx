/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { likeStatus } from '@/lib/client'
import {
  BASE_TIME,
  createMockAnnounce,
  createMockNote,
  mockAlice,
  mockBob,
  multiAuthorConversationScenario,
  selfThreadScenario,
  singlePostScenario
} from '@/lib/components/posts/__fixtures__/timeline-context'
import { Status } from '@/lib/types/domain/status'
import { TimelineContext } from '@/lib/types/domain/timeline'
import { getStatusDetailPathClient } from '@/lib/utils/getStatusDetailPathClient'

import { TimelineFeed } from './timeline-feed'

const mockPush = vi.fn()

vi.mock('./collapsible-content', () => ({
  CollapsibleContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  )
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush
  })
}))

vi.mock('@/lib/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/client')>()
  return {
    ...actual,
    likeStatus: vi.fn(),
    undoLikeStatus: vi.fn(),
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
    onReplyCreated
  }: {
    mode: string
    status: { id: string }
    onReplyCreated?: (status: any) => void
  }) => (
    <div data-testid="inline-composer" data-mode={mode} data-status={status.id}>
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

const mockGetStatusDetailPathClient = vi.mocked(getStatusDetailPathClient)
const mockLikeStatus = vi.mocked(likeStatus)

describe('TimelineFeed', () => {
  beforeEach(() => {
    mockPush.mockClear()
    mockLikeStatus.mockReset()
    mockGetStatusDetailPathClient.mockResolvedValue('/@alice/test')
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

  it('renders a self-thread <= 3 posts with Thread label, connector rails, and in chronological order', () => {
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

    // Verify no connector rails are rendered between avatars
    expect(screen.queryByTestId('connector-rail')).not.toBeInTheDocument()
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

  it('renders a multi-author conversation with Conversation label and connector rails', () => {
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

    // Verify no connector rails are rendered between avatars
    expect(screen.queryByTestId('connector-rail')).not.toBeInTheDocument()
  })

  it('targets the correct status when replying from a thread post', () => {
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

    // Click reply on the second post
    const replyButtons = screen.getAllByRole('button', { name: /reply/i })
    expect(replyButtons.length).toBeGreaterThanOrEqual(3)

    // Click reply on post 2
    fireEvent.click(replyButtons[1])

    const composer = screen.getByTestId('inline-composer')
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

    const likeButtons = screen.getAllByRole('button', { name: /like/i })
    expect(likeButtons.length).toBeGreaterThanOrEqual(3)

    fireEvent.click(likeButtons[0])
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
})
