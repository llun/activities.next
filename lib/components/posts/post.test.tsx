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
  getTranslationCapability,
  getTranslationLanguages,
  likeStatus
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
  translateStatus: vi.fn()
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

    const primaryActions = screen.getByRole('group', {
      name: 'Post primary actions'
    })

    expect(
      within(primaryActions)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual([
      'Reply to post',
      'Repost',
      'Like',
      'Bookmark',
      'Show edit history, 1 edit'
    ])

    // Secondary actions (visibility / edit / delete) are no longer inline; they
    // live behind the overflow "more actions" menu.
    expect(
      screen.queryByRole('group', { name: 'Post secondary actions' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'More actions' })
    ).toBeInTheDocument()
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
      screen.getByRole('group', { name: 'Post primary actions' })
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

    const primaryActions = screen.getByRole('group', {
      name: 'Post primary actions'
    })

    expect(
      within(primaryActions)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual(['Reply to post', 'Repost', 'Like', 'Bookmark'])
    expect(
      screen.queryByRole('group', { name: 'Post secondary actions' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'More actions' })
    ).toBeInTheDocument()
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

    const actionButtons = [
      ...within(
        screen.getByRole('group', { name: 'Post primary actions' })
      ).getAllByRole('button'),
      screen.getByRole('button', { name: 'More actions' })
    ]

    expect(actionButtons).toHaveLength(6)
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

    const primaryActions = screen.getByRole('group', {
      name: 'Post primary actions'
    })

    expect(
      within(primaryActions).getByRole('button', { name: 'Repost' })
    ).toHaveClass('disabled:opacity-50')
    expect(
      within(primaryActions).getByRole('button', { name: 'Like' })
    ).toHaveClass('disabled:opacity-50')
    expect(
      within(primaryActions).getByRole('button', { name: 'Bookmark' })
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
})
