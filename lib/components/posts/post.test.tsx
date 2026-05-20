/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ReactNode } from 'react'

import {
  StatusAnnounce,
  StatusNote,
  StatusType
} from '@/lib/types/domain/status'

import { Post } from './post'

jest.mock('./collapsible-content', () => ({
  CollapsibleContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="collapsible-content">{children}</div>
  )
}))

jest.mock('./poll', () => ({
  Poll: () => null
}))

jest.mock('./attachments', () => ({
  Attachments: () => null
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
  it('does not nest long-post collapse inside expanded content warnings', () => {
    render(
      <Post
        host="activities.local"
        currentTime={currentTime}
        status={status}
        collapsible
        postLineLimit={1}
        onShowAttachment={jest.fn()}
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
        onShowAttachment={jest.fn()}
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
        onShowAttachment={jest.fn()}
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
        onShowAttachment={jest.fn()}
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
        onShowAttachment={jest.fn()}
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
        onShowAttachment={jest.fn()}
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
        onShowAttachment={jest.fn()}
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
        onShowAttachment={jest.fn()}
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
        onShowAttachment={jest.fn()}
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
        onShowAttachment={jest.fn()}
      />
    )

    expect(screen.getByText('@hackers.pub')).toBeInTheDocument()
    expect(screen.queryByText('@notalice')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: '@hackers.pub' })
    ).not.toBeInTheDocument()
  })

  it('splits owner actions into a five-item primary row and left-aligned secondary row', () => {
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
        onEdit={jest.fn()}
        onPostDeleted={jest.fn()}
        onReply={jest.fn()}
        onShowAttachment={jest.fn()}
      />
    )

    const primaryActions = screen.getByRole('group', {
      name: 'Post primary actions'
    })
    const secondaryActions = screen.getByRole('group', {
      name: 'Post secondary actions'
    })

    expect(primaryActions).toHaveClass(
      'grid',
      'w-full',
      'grid-cols-5',
      'justify-items-center',
      'sm:flex',
      'sm:w-auto',
      'sm:justify-start'
    )
    expect(secondaryActions).toHaveClass(
      'grid',
      'w-full',
      'grid-cols-5',
      'justify-items-center',
      'sm:flex',
      'sm:w-auto',
      'sm:justify-start'
    )
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
    expect(
      within(secondaryActions)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual(['Visibility: Direct', 'Edit post', 'Delete post'])
  })

  it('keeps edit history panel open when interacting with panel content', () => {
    const onShowEdits = jest.fn()

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
        onShowAttachment={jest.fn()}
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
        onShowAttachment={jest.fn()}
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
    jest.useFakeTimers()
    jest.setSystemTime(currentTime + 7 * 24 * 60 * 60 * 1000)

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
          onShowAttachment={jest.fn()}
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
      jest.useRealTimers()
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
        onShowAttachment={jest.fn()}
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
        onEdit={jest.fn()}
        onPostDeleted={jest.fn()}
        onShowAttachment={jest.fn()}
      />
    )

    const primaryActions = screen.getByRole('group', {
      name: 'Post primary actions'
    })
    const secondaryActions = screen.getByRole('group', {
      name: 'Post secondary actions'
    })

    expect(primaryActions).toHaveClass('grid-cols-4')
    expect(primaryActions).not.toHaveClass('grid-cols-5')
    expect(
      within(primaryActions)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual(['Reply to post', 'Repost', 'Like', 'Bookmark'])
    expect(secondaryActions).toHaveClass('grid-cols-4')
    expect(secondaryActions).not.toHaveClass('grid-cols-5')
    expect(
      within(secondaryActions)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual(['Visibility: Direct', 'Edit post', 'Delete post'])
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
        onEdit={jest.fn()}
        onPostDeleted={jest.fn()}
        onReply={jest.fn()}
        onShowAttachment={jest.fn()}
      />
    )

    const actionButtons = [
      ...within(
        screen.getByRole('group', { name: 'Post primary actions' })
      ).getAllByRole('button'),
      ...within(
        screen.getByRole('group', { name: 'Post secondary actions' })
      ).getAllByRole('button')
    ]

    expect(actionButtons).toHaveLength(8)
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
        onShowAttachment={jest.fn()}
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

    const secondaryActions = screen.getByRole('group', {
      name: 'Post secondary actions'
    })
    expect(
      within(secondaryActions).getByRole('button', {
        name: 'Visibility: Direct'
      })
    ).toHaveClass('disabled:opacity-50')
  })

  it('resets like action state when rendering updated status data', () => {
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
        onShowAttachment={jest.fn()}
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
          isActorLiked: true,
          totalLikes: 2
        }}
        onShowAttachment={jest.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Unlike, 2 likes' })
    ).toBeInTheDocument()
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
        onShowAttachment={jest.fn()}
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
        onShowAttachment={jest.fn()}
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
        onShowAttachment={jest.fn()}
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
        onShowAttachment={jest.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Remove bookmark' })
    ).toBeInTheDocument()
  })
})
