/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { ReactNode } from 'react'

import { likeStatus } from '@/lib/client'
import { createDeferred } from '@/lib/testing/deferred'

import { Post } from './post'
import { currentTime, status } from './post.testUtils'

vi.mock('./collapsible-content', () => ({
  CollapsibleContent: ({
    children,
    onReadMore
  }: {
    children: ReactNode
    onReadMore?: () => void
  }) => (
    <div data-testid="collapsible-content">
      {children}
      {onReadMore && (
        <button
          type="button"
          data-testid="read-more-button"
          onClick={onReadMore}
        >
          Read full post
        </button>
      )}
    </div>
  )
}))

vi.mock('./poll', () => ({
  Poll: () => null
}))

vi.mock('./attachments', () => ({
  Attachments: () => null
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() })
}))

vi.mock('@/lib/client', () => ({
  bookmarkStatus: vi.fn(),
  undoBookmarkStatus: vi.fn(),
  deleteStatus: vi.fn(),
  likeStatus: vi.fn(),
  undoLikeStatus: vi.fn(),
  repostStatus: vi.fn(),
  undoRepostStatus: vi.fn(),
  updateStatusVisibility: vi.fn(),
  getRelationship: vi.fn().mockResolvedValue(null),
  mute: vi.fn(),
  unmute: vi.fn(),
  block: vi.fn(),
  unblock: vi.fn(),
  createReport: vi.fn(),
  retryFitnessProcessing: vi.fn(),
  getFitnessProcessingState: vi.fn().mockResolvedValue(null),
  getTranslationCapability: vi.fn(),
  getTranslationLanguages: vi.fn(),
  translateStatus: vi.fn(),
  reactToStatus: vi.fn(),
  unreactFromStatus: vi.fn(),
  getCustomEmojis: vi.fn().mockResolvedValue([]),
  // QuoteCard loads the quoted status itself; a quoting status renders it.
  getStatusById: vi.fn().mockResolvedValue(null)
}))

describe('Post', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the reaction row above the action row for a signed-in viewer', () => {
    render(
      <Post
        host="activities.local"
        currentActor={status.actor ?? undefined}
        currentTime={currentTime}
        showActions
        status={{
          ...status,
          reactions: [
            { name: '🔥', count: 2, me: true, url: null, static_url: null }
          ]
        }}
        onShowAttachment={vi.fn()}
      />
    )

    const chip = screen.getByLabelText('Remove 🔥 reaction, 2')
    expect(chip).toHaveTextContent('2')
    // The control that adds one lives in the action row, next to like/boost.
    expect(
      screen.getByRole('button', { name: 'Add reaction, 2 reactions' })
    ).toBeInTheDocument()

    // Ordering is the point of the name: chips belong to the post, so they sit
    // between the content and the action row, not below it.
    const likeButton = screen.getByLabelText(/^Like/)
    expect(
      chip.compareDocumentPosition(likeButton) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('renders reaction chips read-only when the post shows no actions', () => {
    render(
      <Post
        host="activities.local"
        currentActor={status.actor ?? undefined}
        currentTime={currentTime}
        showActions={false}
        status={{
          ...status,
          reactions: [
            { name: '🔥', count: 2, me: false, url: null, static_url: null }
          ]
        }}
        onShowAttachment={vi.fn()}
      />
    )

    // The chip is still readable, but nothing on the row can be actioned —
    // `showActions={false}` withholds the actor from the reaction row too.
    expect(
      screen.getByRole('img', { name: '🔥 reaction, 2' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^Add reaction/ })
    ).not.toBeInTheDocument()
  })

  it('renders the primary action row plus an overflow menu, with owner authoring actions consolidated into the menu', () => {
    render(
      <Post
        host="activities.local"
        currentActor={status.actor ?? undefined}
        currentTime={currentTime}
        editable
        showActions
        status={{
          ...status,
          edits: [{ text: 'Previous content', createdAt: currentTime - 1000 }]
        }}
        onEdit={vi.fn()}
        onPostDeleted={vi.fn()}
        onReply={vi.fn()}
        onShowAttachment={vi.fn()}
      />
    )

    const actions = screen.getByRole('group', {
      name: 'Post actions'
    })

    expect(
      within(actions)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual([
      'Reply to post',
      'Repost',
      'Like',
      'Bookmark',
      'Add reaction',
      'Show edit history, 1 edit',
      'More actions'
    ])

    // Secondary actions (visibility / edit / delete) are no longer inline; they
    // live behind the overflow "more actions" menu.
    expect(
      screen.queryByRole('group', { name: 'Post secondary actions' })
    ).not.toBeInTheDocument()
  })

  it('keeps edit history panel open when interacting with panel content', () => {
    const onShowEdits = vi.fn()

    render(
      <Post
        host="activities.local"
        currentActor={status.actor ?? undefined}
        currentTime={currentTime}
        showActions
        status={{
          ...status,
          edits: [{ text: 'Previous content', createdAt: currentTime - 1000 }]
        }}
        onShowAttachment={vi.fn()}
        onShowEdits={onShowEdits}
      />
    )

    const editHistoryButton = screen.getByRole('button', {
      name: 'Show edit history, 1 edit'
    })

    expect(editHistoryButton).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(editHistoryButton)

    const editHistoryContent = screen.getByText('Previous content')
    const editHistoryRegion = screen.getByRole('region', {
      name: 'Edit history'
    })

    expect(editHistoryContent).toBeInTheDocument()
    expect(onShowEdits).toHaveBeenCalledTimes(1)
    expect(editHistoryRegion).toBeInTheDocument()
    expect(editHistoryButton).toHaveAttribute('aria-expanded', 'true')
    expect(editHistoryButton).toHaveAttribute(
      'aria-controls',
      editHistoryRegion.id
    )

    fireEvent.click(editHistoryContent)

    expect(screen.getByText('Previous content')).toBeInTheDocument()
    expect(onShowEdits).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Close edit history' }))

    expect(screen.queryByText('Previous content')).not.toBeInTheDocument()
    expect(editHistoryButton).toHaveFocus()
  })

  it('renders edit history newest first without mutating status edits', () => {
    const edits = [
      { text: 'First draft', createdAt: currentTime - 2000 },
      { text: 'Second draft', createdAt: currentTime - 1000 }
    ]

    render(
      <Post
        host="activities.local"
        currentActor={status.actor ?? undefined}
        currentTime={currentTime}
        showActions
        status={{
          ...status,
          edits
        }}
        onShowAttachment={vi.fn()}
      />
    )

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Show edit history, 2 edits'
      })
    )

    const historyItems = screen.getAllByRole('listitem')

    expect(
      within(historyItems[0]).getByText('Second draft')
    ).toBeInTheDocument()
    expect(within(historyItems[1]).getByText('First draft')).toBeInTheDocument()
    expect(edits.map((edit) => edit.text)).toEqual([
      'First draft',
      'Second draft'
    ])
  })

  it('uses currentTime for edit history relative timestamps', () => {
    vi.useFakeTimers()
    vi.setSystemTime(currentTime + 7 * 24 * 60 * 60 * 1000)

    try {
      render(
        <Post
          host="activities.local"
          currentActor={status.actor ?? undefined}
          currentTime={currentTime}
          showActions
          status={{
            ...status,
            edits: [
              { text: 'Previous content', createdAt: currentTime - 60000 }
            ]
          }}
          onShowAttachment={vi.fn()}
        />
      )

      fireEvent.click(
        screen.getByRole('button', {
          name: 'Show edit history, 1 edit'
        })
      )

      expect(screen.getByText('1 minute')).toBeInTheDocument()
      expect(screen.queryByText('7 days')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not render an empty status action group', () => {
    render(
      <Post
        host="activities.local"
        currentActor={{
          ...status.actor!,
          id: 'https://activities.local/users/other',
          username: 'other'
        }}
        currentTime={currentTime}
        showActions
        status={status}
        onShowAttachment={vi.fn()}
      />
    )

    expect(
      screen.getByRole('group', { name: 'Post actions' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('group', { name: 'Post secondary actions' })
    ).not.toBeInTheDocument()
  })

  it('does not render edit history action when status has no edits', () => {
    render(
      <Post
        host="activities.local"
        currentActor={status.actor ?? undefined}
        currentTime={currentTime}
        editable
        showActions
        status={status}
        onEdit={vi.fn()}
        onPostDeleted={vi.fn()}
        onShowAttachment={vi.fn()}
      />
    )

    const actions = screen.getByRole('group', {
      name: 'Post actions'
    })

    expect(
      within(actions)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual([
      'Reply to post',
      'Repost',
      'Like',
      'Bookmark',
      'Add reaction',
      'More actions'
    ])
    expect(
      screen.queryByRole('group', { name: 'Post secondary actions' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Show edit history/ })
    ).not.toBeInTheDocument()
  })

  it('resets like action state when rendering a different status', () => {
    const otherActor = {
      ...status.actor!,
      id: 'https://activities.local/users/other',
      username: 'other'
    }
    const { rerender } = render(
      <Post
        host="activities.local"
        currentActor={otherActor}
        currentTime={currentTime}
        showActions
        status={status}
        onShowAttachment={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Like' })).toBeInTheDocument()

    rerender(
      <Post
        host="activities.local"
        currentActor={otherActor}
        currentTime={currentTime}
        showActions
        status={{
          ...status,
          id: 'https://activities.local/users/llun/statuses/post-2',
          url: 'https://activities.local/@llun/post-2',
          isActorLiked: true,
          totalLikes: 2
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Unlike, 2 likes' })
    ).toBeInTheDocument()
  })

  it('keeps pending like action state when the same status receives updated counts', async () => {
    const deferred = createDeferred<boolean>()
    ;(likeStatus as jest.Mock).mockReturnValue(deferred.promise)
    const otherActor = {
      ...status.actor!,
      id: 'https://activities.local/users/other',
      username: 'other'
    }
    const { rerender } = render(
      <Post
        host="activities.local"
        currentActor={otherActor}
        currentTime={currentTime}
        showActions
        status={status}
        onShowAttachment={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Like' }))

    expect(screen.getByRole('button', { name: 'Like' })).toBeDisabled()

    rerender(
      <Post
        host="activities.local"
        currentActor={otherActor}
        currentTime={currentTime}
        showActions
        status={{
          ...status,
          totalLikes: 4
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(
      await screen.findByRole('button', { name: 'Like, 4 likes' })
    ).toBeDisabled()
    expect(likeStatus).toHaveBeenCalledTimes(1)

    await act(async () => {
      deferred.resolve(true)
      await deferred.promise
    })

    expect(
      screen.getByRole('button', { name: 'Unlike, 5 likes' })
    ).toBeEnabled()
  })

  it('keeps visible social action counts in accessible labels', () => {
    render(
      <Post
        host="activities.local"
        currentActor={{
          ...status.actor!,
          id: 'https://activities.local/users/other',
          username: 'other'
        }}
        currentTime={currentTime}
        showActions
        status={{
          ...status,
          replies: [
            { ...status, id: 'https://activities.local/replies/1' },
            { ...status, id: 'https://activities.local/replies/2' }
          ],
          totalLikes: 3
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Reply to post, 2 replies' })
    ).toHaveAttribute('title', 'Reply to post, 2 replies')
    expect(
      screen.getByRole('button', { name: 'Like, 3 likes' })
    ).toHaveAttribute('title', 'Like, 3 likes')
  })

  it('keeps singular social action counts in accessible labels', () => {
    render(
      <Post
        host="activities.local"
        currentActor={{
          ...status.actor!,
          id: 'https://activities.local/users/other',
          username: 'other'
        }}
        currentTime={currentTime}
        showActions
        status={{
          ...status,
          replies: [{ ...status, id: 'https://activities.local/replies/1' }],
          totalLikes: 1
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Reply to post, 1 reply' })
    ).toHaveAttribute('title', 'Reply to post, 1 reply')
    expect(
      screen.getByRole('button', { name: 'Like, 1 like' })
    ).toHaveAttribute('title', 'Like, 1 like')
  })

  it('labels repost action as undo when post is already reposted', () => {
    render(
      <Post
        host="activities.local"
        currentActor={{
          ...status.actor!,
          id: 'https://activities.local/users/other',
          username: 'other'
        }}
        currentTime={currentTime}
        showActions
        status={{
          ...status,
          actorAnnounceStatusId: 'https://activities.local/announces/1'
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Undo repost' })
    ).toBeInTheDocument()
  })

  it('labels bookmark action as remove when post is already bookmarked', () => {
    render(
      <Post
        host="activities.local"
        currentActor={{
          ...status.actor!,
          id: 'https://activities.local/users/other',
          username: 'other'
        }}
        currentTime={currentTime}
        showActions
        status={{
          ...status,
          isActorBookmarked: true
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Remove bookmark' })
    ).toBeInTheDocument()
  })
})
