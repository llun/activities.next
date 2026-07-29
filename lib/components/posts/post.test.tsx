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
  bookmarkStatus,
  getTranslationCapability,
  getTranslationLanguages,
  likeStatus,
  reactToStatus
} from '@/lib/client'
import {
  StatusAnnounce,
  StatusNote,
  StatusType
} from '@/lib/types/domain/status'

import { Post } from './post'

vi.mock('./collapsible-content', () => ({
  CollapsibleContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="collapsible-content">{children}</div>
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
  getCustomEmojis: vi.fn().mockResolvedValue([])
}))

const currentTime = new Date('2026-04-26T10:00:00.000Z').getTime()

const status: StatusNote = {
  id: 'https://activities.local/users/llun/statuses/post-1',
  actorId: 'https://activities.local/users/llun',
  actor: {
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
    createdAt: currentTime
  },
  to: [],
  cc: [],
  edits: [],
  isLocalActor: true,
  createdAt: currentTime,
  updatedAt: currentTime,
  type: StatusType.enum.Note,
  url: 'https://activities.local/@llun/post-1',
  text: 'Long content',
  summary: 'Spoilers',
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  isActorBookmarked: false,
  totalLikes: 0,
  totalShares: 0,
  attachments: [],
  tags: []
}

const boostedStatus: StatusAnnounce = {
  id: 'https://remote.example/users/booster/statuses/boost-1/activity',
  actorId: 'https://remote.example/users/booster',
  actor: {
    id: 'https://remote.example/users/booster',
    username: 'booster',
    domain: 'remote.example',
    name: 'Booster',
    followersUrl: 'https://remote.example/users/booster/followers',
    inboxUrl: 'https://remote.example/users/booster/inbox',
    sharedInboxUrl: 'https://remote.example/inbox',
    followingCount: 0,
    followersCount: 0,
    statusCount: 0,
    lastStatusAt: null,
    createdAt: currentTime
  },
  to: [],
  cc: [],
  edits: [],
  isLocalActor: false,
  createdAt: currentTime,
  updatedAt: currentTime,
  type: StatusType.enum.Announce,
  originalStatus: {
    ...status,
    id: 'https://origin.example/users/original/statuses/post-1',
    actorId: 'https://origin.example/users/original',
    actor: {
      id: 'https://origin.example/users/original',
      username: 'original',
      domain: 'origin.example',
      name: 'Original',
      followersUrl: 'https://origin.example/users/original/followers',
      inboxUrl: 'https://origin.example/users/original/inbox',
      sharedInboxUrl: 'https://origin.example/inbox',
      followingCount: 0,
      followersCount: 0,
      statusCount: 0,
      lastStatusAt: null,
      createdAt: currentTime
    },
    isLocalActor: false,
    url: 'https://origin.example/@original/post-1',
    text: 'Original post',
    summary: null
  }
}

describe('Post', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not nest long-post collapse inside expanded content warnings', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={status}
        collapsible
        postLineLimit={1}
        onShowAttachment={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show content' }))

    expect(screen.queryByTestId('collapsible-content')).not.toBeInTheDocument()
  })

  it('renders boosts with the booster label and original post actor', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={boostedStatus}
        onShowAttachment={vi.fn()}
      />
    )

    expect(screen.getByText('Boosted by Booster')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Original' })).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Booster' })
    ).not.toBeInTheDocument()
  })

  it('falls back to the boost actor id when the actor profile is absent', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...boostedStatus,
          actor: null,
          actorId: 'https://remote.example/@booster'
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(
      screen.getByText('Boosted by @booster@remote.example')
    ).toBeInTheDocument()
  })

  it('normalizes prefixed remote actor usernames in post handles', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...boostedStatus,
          originalStatus: {
            ...boostedStatus.originalStatus,
            actor: {
              ...boostedStatus.originalStatus.actor!,
              username: '@original',
              name: undefined
            }
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(screen.getByRole('link', { name: 'original' })).toHaveAttribute(
      'href',
      '/@original@origin.example'
    )
    expect(screen.getByText('@original@origin.example')).toBeInTheDocument()
    expect(
      screen.queryByText('@@original@origin.example')
    ).not.toBeInTheDocument()
  })

  it('normalizes actor id handles when the actor profile is absent', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...boostedStatus,
          originalStatus: {
            ...boostedStatus.originalStatus,
            actorId: 'https://origin.example/@original',
            actor: null
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(screen.getByRole('link', { name: '@original' })).toHaveAttribute(
      'href',
      '/@original@origin.example'
    )
    expect(screen.getByText('@origin.example')).toBeInTheDocument()
    expect(
      screen.queryByText('@@original@origin.example')
    ).not.toBeInTheDocument()
  })

  it('uses the status url handle when actor ids are opaque', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...boostedStatus,
          originalStatus: {
            ...boostedStatus.originalStatus,
            actorId:
              'https://hackers.pub/ap/actors/019382d3-63d7-7cf7-86e8-91e2551c306c',
            actor: null,
            url: 'https://hackers.pub/@hongminhee/019dc9aa-ebc9-7059-8de2-f5850dbeea4e'
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(screen.getByRole('link', { name: '@hongminhee' })).toHaveAttribute(
      'href',
      '/@hongminhee@hackers.pub'
    )
    expect(screen.getByText('@hackers.pub')).toBeInTheDocument()
    expect(
      screen.queryByText('@019382d3-63d7-7cf7-86e8-91e2551c306c')
    ).not.toBeInTheDocument()
  })

  it('falls back to the actor domain when opaque actor ids have no usable status handle', () => {
    const actorId =
      'https://hackers.pub/ap/actors/019382d3-63d7-7cf7-86e8-91e2551c306c'

    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...boostedStatus,
          originalStatus: {
            ...boostedStatus.originalStatus,
            actorId,
            actor: null,
            url: 'https://hackers.pub/ap/notes/019dc9aa-ebc9-7059-8de2-f5850dbeea4e'
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(screen.getByText('@hackers.pub')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: '@hackers.pub' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('@019382d3-63d7-7cf7-86e8-91e2551c306c')
    ).not.toBeInTheDocument()
  })

  it('uses bsky profile handles from bridgy status urls', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...boostedStatus,
          originalStatus: {
            ...boostedStatus.originalStatus,
            actorId: 'https://bsky.brid.gy/ap/did:plc:2gkh62xvzokhlf6li4ol3b3d',
            actor: null,
            url: 'https://bsky.brid.gy/r/https://bsky.app/profile/patak.cat/post/3mknrszqses2y'
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(screen.getByRole('link', { name: '@patak.cat' })).toHaveAttribute(
      'href',
      '/@patak.cat@bsky.brid.gy'
    )
    expect(screen.getByText('@bsky.brid.gy')).toBeInTheDocument()
    expect(
      screen.queryByText('@did:plc:2gkh62xvzokhlf6li4ol3b3d')
    ).not.toBeInTheDocument()
  })

  it('ignores malformed bridgy embedded status urls', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...boostedStatus,
          originalStatus: {
            ...boostedStatus.originalStatus,
            actorId: 'https://bsky.brid.gy/ap/did:plc:2gkh62xvzokhlf6li4ol3b3d',
            actor: null,
            url: 'https://bsky.brid.gy/r/%E0%A4%A'
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(screen.getByText('@bsky.brid.gy')).toBeInTheDocument()
    expect(screen.queryByText('@patak.cat')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: '@bsky.brid.gy' })
    ).not.toBeInTheDocument()
  })

  it('does not infer bsky profile handles from unrelated status url paths', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...boostedStatus,
          originalStatus: {
            ...boostedStatus.originalStatus,
            actorId:
              'https://hackers.pub/ap/actors/019382d3-63d7-7cf7-86e8-91e2551c306c',
            actor: null,
            url: 'https://example.com/posts/bsky.app/profile/notalice'
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(screen.getByText('@hackers.pub')).toBeInTheDocument()
    expect(screen.queryByText('@notalice')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: '@hackers.pub' })
    ).not.toBeInTheDocument()
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

  it('uses a pointer cursor for status action buttons', () => {
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

    const actionButtons = within(
      screen.getByRole('group', { name: 'Post actions' })
    ).getAllByRole('button')

    expect(actionButtons).toHaveLength(7)
    actionButtons.forEach((button) => {
      expect(button).toHaveClass('cursor-pointer')
    })
  })

  it('uses disabled opacity styling for async-capable status action buttons', () => {
    render(
      <Post
        host="activities.local"
        currentActor={status.actor ?? undefined}
        currentTime={currentTime}
        editable
        showActions
        status={status}
        onShowAttachment={vi.fn()}
      />
    )

    const actions = screen.getByRole('group', {
      name: 'Post actions'
    })

    expect(within(actions).getByRole('button', { name: 'Repost' })).toHaveClass(
      'disabled:opacity-50'
    )
    expect(within(actions).getByRole('button', { name: 'Like' })).toHaveClass(
      'disabled:opacity-50'
    )
    expect(
      within(actions).getByRole('button', { name: 'Bookmark' })
    ).toHaveClass('disabled:opacity-50')
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
    let resolveLike: (value: boolean) => void = () => {}
    const likePromise = new Promise<boolean>((resolve) => {
      resolveLike = resolve
    })
    ;(likeStatus as jest.Mock).mockReturnValue(likePromise)
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
      resolveLike(true)
      await likePromise
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

  const fitnessBase = {
    id: 'fitness-1',
    fileName: 'strava-123.tcx',
    fileType: 'tcx' as const,
    mimeType: 'application/vnd.garmin.tcx+xml',
    bytes: 1024,
    url: '/api/v1/fitness-files/fitness-1',
    processingStatus: 'completed' as const
  }

  it('renders a "View on Strava" source link from the fitness source URL', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...status,
          summary: null,
          fitness: {
            ...fitnessBase,
            sourceUrl: 'https://www.strava.com/activities/123'
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    const link = screen.getByRole('link', { name: /View on Strava/i })
    expect(link).toHaveAttribute(
      'href',
      'https://www.strava.com/activities/123'
    )
  })

  it('does not render a source link when the URL uses an unsafe scheme', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...status,
          summary: null,
          fitness: {
            ...fitnessBase,
            // eslint-disable-next-line no-script-url
            sourceUrl: 'javascript:alert(1)'
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(
      screen.queryByRole('link', { name: /View on Strava|View source/i })
    ).not.toBeInTheDocument()
  })

  it('shows the staged processing progress while a fresh fitness file is still processing', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        currentActor={status.actor!}
        status={{
          ...status,
          summary: null,
          fitness: {
            ...fitnessBase,
            processingStatus: 'processing',
            processingStuck: false
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(screen.getByText(/Generating route map/i)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Retry/i })
    ).not.toBeInTheDocument()
  })

  it('offers the owner a retry instead of an endless spinner once processing is stuck', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        currentActor={status.actor!}
        status={{
          ...status,
          summary: null,
          fitness: {
            ...fitnessBase,
            processingStatus: 'processing',
            processingStuck: true
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument()
    expect(
      screen.queryByText(/Generating route map|Queued for processing/i)
    ).not.toBeInTheDocument()
  })

  describe('fitness route map failure', () => {
    // A missing route map is a degraded success: the activity parsed, the post
    // federated, the stats are real. It must not read as a failed post — the
    // whole reason the failure is recorded in `mapError` and not in
    // `processingStatus`.
    const mapFailedStatus = {
      ...status,
      summary: null,
      fitness: {
        ...fitnessBase,
        processingStatus: 'completed' as const,
        totalDistanceMeters: 11400,
        totalDurationSeconds: 9480,
        elevationGainMeters: 964,
        activityType: 'run',
        mapFailure: 'missing' as const
      }
    }

    it('offers the owner a retry that reads as a missing map, not a failed post', () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          currentActor={status.actor!}
          status={mapFailedStatus}
          onShowAttachment={vi.fn()}
        />
      )

      expect(
        screen.getByText(/route map image could not be generated/i)
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument()
      expect(screen.queryByText(/Processing failed/i)).not.toBeInTheDocument()
    })

    it('keeps the stats the activity did produce', () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          currentActor={status.actor!}
          status={mapFailedStatus}
          onShowAttachment={vi.fn()}
        />
      )

      // Reusing `processingStatus: 'failed'` for this would hide all of these.
      expect(screen.getByText('Distance')).toBeInTheDocument()
      expect(screen.getByText('Duration')).toBeInTheDocument()
    })

    it('does not claim there is no map when the previous one is still shown', () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          currentActor={status.actor!}
          status={{
            ...mapFailedStatus,
            fitness: {
              ...mapFailedStatus.fitness,
              mapFailure: 'stale' as const
            }
          }}
          onShowAttachment={vi.fn()}
        />
      )

      // A failed REgeneration keeps the map it could not replace. Saying it
      // "could not be generated" would read as "you have no map" when the truth
      // is that the old one — possibly predating a privacy location the owner
      // just added — is still on the post.
      expect(
        screen.getByText(/could not be updated, so this is the previous one/i)
      ).toBeInTheDocument()
      expect(
        screen.queryByText(/could not be generated/i)
      ).not.toBeInTheDocument()
    })

    it('says nothing to a viewer who is not the owner', () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          status={mapFailedStatus}
          onShowAttachment={vi.fn()}
        />
      )

      // Someone else's missing image is not a reader's problem.
      expect(
        screen.queryByText(/route map image could not be generated/i)
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /Retry/i })
      ).not.toBeInTheDocument()
      expect(screen.getByText('Distance')).toBeInTheDocument()
    })
  })

  it('renders the labeled stat grid, type pill, and device for a completed fitness file', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...status,
          summary: null,
          fitness: {
            ...fitnessBase,
            fileType: 'fit',
            fileName: '2025-05-27-skitour.fit',
            totalDistanceMeters: 11400,
            totalDurationSeconds: 9480,
            elevationGainMeters: 964,
            activityType: 'run',
            deviceManufacturer: 'garmin',
            deviceName: 'Fenix 7'
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    // File name and lowercase type pill.
    expect(screen.getByText('2025-05-27-skitour.fit')).toBeInTheDocument()
    expect(screen.getByText('fit')).toBeInTheDocument()
    // Stats render as labeled cells (label and value are separate elements,
    // not the old "Distance: <value>" inline text).
    expect(screen.getByText('Distance')).toBeInTheDocument()
    expect(screen.getByText('11.4 km')).toBeInTheDocument()
    expect(screen.getByText('Duration')).toBeInTheDocument()
    expect(screen.getByText('2:38:00')).toBeInTheDocument()
    // A run activity surfaces Pace (not Avg speed) via getFitnessPaceOrSpeed.
    expect(screen.getByText('Pace')).toBeInTheDocument()
    expect(screen.getByText('Elevation')).toBeInTheDocument()
    expect(screen.getByText('964 m')).toBeInTheDocument()
    // Recording device footer links to the brand.
    expect(screen.getByRole('link', { name: 'Fenix 7' })).toBeInTheDocument()
    // Screen-reader label replaces the dropped visible "Fitness" text.
    expect(screen.getByText('Fitness activity')).toBeInTheDocument()
    // The old inline "Distance: <value>" treatment is gone.
    expect(screen.queryByText(/Distance:/)).not.toBeInTheDocument()
  })

  it('surfaces Avg speed (not Pace) for a cycling activity', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...status,
          summary: null,
          fitness: {
            ...fitnessBase,
            totalDistanceMeters: 26200,
            totalDurationSeconds: 3822,
            activityType: 'ride'
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(screen.getByText('Avg speed')).toBeInTheDocument()
    expect(screen.getByText('24.7 km/h')).toBeInTheDocument()
    expect(screen.queryByText('Pace')).not.toBeInTheDocument()
  })

  it('drops stat cells whose metric the file does not provide', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...status,
          summary: null,
          fitness: {
            ...fitnessBase,
            // Only distance is present: no duration/elevation, and pace/speed
            // needs both distance and duration, so those cells are dropped.
            totalDistanceMeters: 5000
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    expect(screen.getByText('Distance')).toBeInTheDocument()
    expect(screen.getByText('5.00 km')).toBeInTheDocument()
    expect(screen.queryByText('Duration')).not.toBeInTheDocument()
    expect(screen.queryByText('Elevation')).not.toBeInTheDocument()
    expect(screen.queryByText('Pace')).not.toBeInTheDocument()
    expect(screen.queryByText('Avg speed')).not.toBeInTheDocument()
  })

  it('omits the stat grid entirely when no metrics are available but still shows the device', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={{
          ...status,
          summary: null,
          fitness: {
            ...fitnessBase,
            // Completed, but nothing measurable parsed out of the file.
            deviceManufacturer: 'garmin',
            deviceName: 'Fenix 7'
          }
        }}
        onShowAttachment={vi.fn()}
      />
    )

    // No stat grid at all.
    expect(screen.queryByText('Distance')).not.toBeInTheDocument()
    expect(screen.queryByText('Duration')).not.toBeInTheDocument()
    expect(screen.queryByText('Elevation')).not.toBeInTheDocument()
    // The file row and the decoupled device footer still render.
    expect(screen.getByText('strava-123.tcx')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Fenix 7' })).toBeInTheDocument()
  })

  describe('Translate gating', () => {
    beforeEach(() => {
      ;(getTranslationCapability as jest.Mock).mockResolvedValue({
        enabled: true,
        defaultLanguage: 'en'
      })
      ;(getTranslationLanguages as jest.Mock).mockResolvedValue({
        th: ['en']
      })
    })

    it('offers Translate when the content-detected language overrides a mislabeled declared language', async () => {
      render(
        <Post
          host="activities.local"
          currentActor={status.actor ?? undefined}
          currentTime={currentTime}
          status={{
            ...status,
            summary: null,
            language: 'en',
            detectedLanguage: 'th'
          }}
          onShowAttachment={vi.fn()}
        />
      )

      expect(
        await screen.findByRole('button', { name: /Translate from Thai/ })
      ).toBeInTheDocument()
    })

    it('does not offer Translate for a signed-out viewer even with a detected language', async () => {
      render(
        <Post
          host="activities.local"
          currentTime={currentTime}
          status={{
            ...status,
            summary: null,
            language: 'en',
            detectedLanguage: 'th'
          }}
          onShowAttachment={vi.fn()}
        />
      )

      await waitFor(() =>
        expect(getTranslationCapability).not.toHaveBeenCalled()
      )
      expect(
        screen.queryByRole('button', { name: /Translate/ })
      ).not.toBeInTheDocument()
    })

    it('does not offer Translate when the resolved source matches the viewer default language', async () => {
      ;(getTranslationLanguages as jest.Mock).mockResolvedValue({
        en: ['th']
      })

      render(
        <Post
          host="activities.local"
          currentActor={status.actor ?? undefined}
          currentTime={currentTime}
          status={{
            ...status,
            summary: null,
            language: 'th',
            detectedLanguage: 'en'
          }}
          onShowAttachment={vi.fn()}
        />
      )

      await waitFor(() => expect(getTranslationCapability).toHaveBeenCalled())
      expect(
        screen.queryByRole('button', { name: /Translate/ })
      ).not.toBeInTheDocument()
    })
  })

  describe('narrow action row', () => {
    // jsdom has no ResizeObserver and lays nothing out, so stand one in that
    // reports a width the test chooses — the row measures its own container,
    // not the viewport, so this is the only thing that decides compact vs.
    // full. `resizeTo` re-delivers, which is what makes a width *change*
    // (rather than just an initial width) testable.
    let resizeTo: ((width: number) => void) | null = null

    const observeWidth = (width: number) => {
      resizeTo = null
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(
            private readonly callback: (entries: ResizeObserverEntry[]) => void
          ) {}
          observe(target: Element) {
            const emit = (next: number) => {
              this.callback([
                {
                  target,
                  contentRect: { width: next } as DOMRectReadOnly
                } as ResizeObserverEntry
              ])
            }
            resizeTo = emit
            emit(width)
          }
          unobserve() {}
          disconnect() {}
        }
      )
    }

    const openMenu = async () => {
      fireEvent.keyDown(screen.getByRole('button', { name: 'More actions' }), {
        key: 'ArrowDown'
      })
      return screen.findByRole('menu')
    }

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('keeps every action in the row when the post is wide enough', () => {
      observeWidth(900)
      render(
        <Post
          host="activities.local"
          currentActor={status.actor ?? undefined}
          currentTime={currentTime}
          showActions
          status={status}
          onShowAttachment={vi.fn()}
        />
      )

      expect(
        within(screen.getByRole('group', { name: 'Post actions' }))
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
    })

    it('spans the whole status with its actions evenly distributed', () => {
      observeWidth(900)
      render(
        <Post
          host="activities.local"
          currentActor={status.actor ?? undefined}
          currentTime={currentTime}
          showActions
          status={{
            ...status,
            reactions: [
              { name: '🔥', count: 2, me: false, url: null, static_url: null }
            ]
          }}
          onShowAttachment={vi.fn()}
        />
      )

      const actions = screen.getByRole('group', { name: 'Post actions' })
      // Pinned because none of it is observable in jsdom and all three are
      // load-bearing: `-ml-13` is what pulls the row back over the avatar
      // column, `justify-between` is what spreads it, and an `ml-auto` on the
      // ⋯ wrapper would silently absorb the free space and re-cluster the row
      // (the design-system rule the docs now carry).
      // `mt-3` rides along with the pull in `Actions`' `fullBleed` default, so
      // pin it here too — dropping it silently closes the gap between every
      // post body and its action row on every surface.
      expect(actions).toHaveClass('-ml-13', 'mt-3', 'justify-between')
      expect(
        screen.getByRole('button', { name: 'More actions' }).parentElement
      ).not.toHaveClass('ml-auto')
      // The chips are full-bleed with it, or they line up with nothing.
      expect(
        screen.getByLabelText('Add 🔥 reaction, 2').parentElement
      ).toHaveClass('-ml-13')
    })

    it('hands bookmark and react to the overflow menu when the post is narrow', async () => {
      observeWidth(320)
      render(
        <Post
          host="activities.local"
          currentActor={status.actor ?? undefined}
          currentTime={currentTime}
          showActions
          status={status}
          onShowAttachment={vi.fn()}
        />
      )

      // Reply / boost / like keep their place; the two that would not fit at a
      // comfortable hit size move into the menu that is already there.
      expect(
        within(screen.getByRole('group', { name: 'Post actions' }))
          .getAllByRole('button')
          .map((button) => button.getAttribute('aria-label'))
      ).toEqual(['Reply to post', 'Repost', 'Like', 'More actions'])

      // `justify-between` distributes by element, so an empty wrapper left
      // behind where a control used to be would silently claim one of the gaps
      // and shift every other action.
      expect(
        screen.getByRole('group', { name: 'Post actions' }).children
      ).toHaveLength(4)

      const menu = await openMenu()
      expect(
        within(menu).getByRole('menuitem', { name: 'React to post' })
      ).toBeInTheDocument()
      expect(
        within(menu).getByRole('menuitem', { name: 'Bookmark' })
      ).toBeInTheDocument()
    })

    it('opens the reaction picker from the overflow menu', async () => {
      observeWidth(320)
      render(
        <Post
          host="activities.local"
          currentActor={status.actor ?? undefined}
          currentTime={currentTime}
          showActions
          status={status}
          onShowAttachment={vi.fn()}
        />
      )

      const menu = await openMenu()
      fireEvent.click(
        within(menu).getByRole('menuitem', { name: 'React to post' })
      )

      expect(
        await screen.findByRole('dialog', { name: 'Choose a reaction' })
      ).toBeInTheDocument()
      // The whole point of `deferUntilClosed`: without it Radix restores focus
      // to the ⋯ trigger as the menu unmounts, which lands after the panel has
      // taken it and leaves a keyboard user back at the top of the document.
      await waitFor(() =>
        expect(screen.getByLabelText('Search emoji')).toHaveFocus()
      )
    })

    it('surfaces a failed reaction even though the trigger is in the menu', async () => {
      observeWidth(320)
      ;(reactToStatus as jest.Mock).mockResolvedValue({
        ok: false,
        error: 'You can only add 8 reactions to a post.'
      })
      render(
        <Post
          host="activities.local"
          currentActor={status.actor ?? undefined}
          currentTime={currentTime}
          showActions
          status={{
            ...status,
            reactions: [
              { name: '🔥', count: 2, me: false, url: null, static_url: null }
            ]
          }}
          onShowAttachment={vi.fn()}
        />
      )

      fireEvent.click(screen.getByLabelText('Add 🔥 reaction, 2'))

      // The button that normally renders this error is not in the row at this
      // width, so without an explicit home the refusal would be invisible.
      expect(await screen.findByTestId('reaction-error')).toHaveTextContent(
        'You can only add 8 reactions to a post.'
      )
    })

    it('surfaces a failed bookmark even though the button is in the menu', async () => {
      observeWidth(320)
      ;(bookmarkStatus as jest.Mock).mockResolvedValue(false)
      render(
        <Post
          host="activities.local"
          currentActor={status.actor ?? undefined}
          currentTime={currentTime}
          showActions
          status={status}
          onShowAttachment={vi.fn()}
        />
      )

      const menu = await openMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Bookmark' }))

      expect(await screen.findByTestId('bookmark-error')).toHaveTextContent(
        'Failed to bookmark post. Please try again.'
      )
    })

    it('closes an open picker onto the new trigger when the row turns compact', async () => {
      observeWidth(900)
      render(
        <Post
          host="activities.local"
          currentActor={status.actor ?? undefined}
          currentTime={currentTime}
          showActions
          status={status}
          onShowAttachment={vi.fn()}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Add reaction' }))
      await screen.findByRole('dialog', { name: 'Choose a reaction' })

      act(() => resizeTo?.(320))

      // The panel is placed from its anchor's rect once, and the anchor it was
      // measured against has just unmounted — so leaving it open would strand
      // it over empty space. Focus has to follow it somewhere deliberate, not
      // fall back to <body> with the panel gone.
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'Choose a reaction' })
        ).not.toBeInTheDocument()
      )
      expect(screen.getByRole('button', { name: 'More actions' })).toHaveFocus()
    })

    it('disables the menu items whose write is already in flight', async () => {
      observeWidth(320)
      let settleBookmark: (value: boolean) => void = () => {}
      ;(bookmarkStatus as jest.Mock).mockReturnValue(
        new Promise<boolean>((resolve) => {
          settleBookmark = resolve
        })
      )
      ;(reactToStatus as jest.Mock).mockReturnValue(new Promise(() => {}))
      render(
        <Post
          host="activities.local"
          currentActor={status.actor ?? undefined}
          currentTime={currentTime}
          showActions
          status={{
            ...status,
            reactions: [
              { name: '🔥', count: 2, me: false, url: null, static_url: null }
            ]
          }}
          onShowAttachment={vi.fn()}
        />
      )

      fireEvent.click(screen.getByLabelText('Add 🔥 reaction, 2'))
      fireEvent.click(
        within(await openMenu()).getByRole('menuitem', {
          name: 'Bookmark'
        })
      )
      await waitFor(() => expect(bookmarkStatus).toHaveBeenCalledTimes(1))

      // Unlike the buttons they replace, menu items carry no busy styling, so
      // without this a tap during a pending write is swallowed by the
      // single-flight guard with nothing on screen to explain it.
      const menu = await openMenu()
      expect(
        within(menu).getByRole('menuitem', { name: 'React to post' })
      ).toHaveAttribute('data-disabled')
      expect(
        within(menu).getByRole('menuitem', { name: 'Bookmark' })
      ).toHaveAttribute('data-disabled')

      // …and comes back once its own write settles. Asserted on the still-open
      // menu: Radix `aria-hidden`s the rest of the document while it is up, so
      // reopening would not find the ⋯ trigger.
      await act(async () => {
        settleBookmark(true)
      })
      expect(
        within(menu).getByRole('menuitem', { name: 'Remove bookmark' })
      ).not.toHaveAttribute('data-disabled')
      // The reaction write is still in flight, so that one stays disabled —
      // the two are independent, not one shared busy flag.
      expect(
        within(menu).getByRole('menuitem', { name: 'React to post' })
      ).toHaveAttribute('data-disabled')
    })

    it('stacks a bookmark and a reaction failure instead of overlapping them', async () => {
      observeWidth(320)
      ;(bookmarkStatus as jest.Mock).mockResolvedValue(false)
      ;(reactToStatus as jest.Mock).mockResolvedValue({ ok: false })
      render(
        <Post
          host="activities.local"
          currentActor={status.actor ?? undefined}
          currentTime={currentTime}
          showActions
          status={{
            ...status,
            reactions: [
              { name: '🔥', count: 2, me: false, url: null, static_url: null }
            ]
          }}
          onShowAttachment={vi.fn()}
        />
      )

      const menu = await openMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Bookmark' }))
      const bookmarkError = await screen.findByTestId('bookmark-error')
      fireEvent.click(screen.getByLabelText('Add 🔥 reaction, 2'))
      const reactionError = await screen.findByTestId('reaction-error')

      // Both writes are independent, so both can fail inside one dismiss
      // window. Sharing a parent is not the point and would have been true of
      // the broken version too — what matters is that neither positions
      // itself: individually anchored they were two opaque boxes at the same
      // `right-0 top-full`, one hiding the other. They are laid out by one
      // stack instead.
      expect(bookmarkError).not.toHaveClass('absolute')
      expect(reactionError).not.toHaveClass('absolute')
      expect(bookmarkError.parentElement).toBe(reactionError.parentElement)
      expect(bookmarkError.parentElement).toHaveClass('absolute', 'flex-col')
    })

    it('keeps the bookmark it took while wide when the row turns compact', async () => {
      observeWidth(900)
      ;(bookmarkStatus as jest.Mock).mockResolvedValue(true)
      render(
        <Post
          host="activities.local"
          currentActor={status.actor ?? undefined}
          currentTime={currentTime}
          showActions
          status={status}
          onShowAttachment={vi.fn()}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Bookmark' }))
      await screen.findByRole('button', { name: 'Remove bookmark' })

      act(() => resizeTo?.(320))

      // This is the whole reason the bookmark state sits in the row rather than
      // in the button: the button unmounts here, and a second copy of the state
      // in the menu item would offer to bookmark a post that already is one.
      expect(
        within(await openMenu()).getByRole('menuitem', {
          name: 'Remove bookmark'
        })
      ).toBeInTheDocument()
    })

    it('bookmarks from the overflow menu', async () => {
      observeWidth(320)
      ;(bookmarkStatus as jest.Mock).mockResolvedValue(true)
      render(
        <Post
          host="activities.local"
          currentActor={status.actor ?? undefined}
          currentTime={currentTime}
          showActions
          status={status}
          onShowAttachment={vi.fn()}
        />
      )

      const menu = await openMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Bookmark' }))

      await waitFor(() =>
        expect(bookmarkStatus).toHaveBeenCalledWith({ statusId: status.id })
      )
      // The state lives in the row, so reopening the menu offers the undo —
      // it is not a second, independent copy of the bookmark.
      expect(
        within(await openMenu()).getByRole('menuitem', {
          name: 'Remove bookmark'
        })
      ).toBeInTheDocument()
    })
  })
})
