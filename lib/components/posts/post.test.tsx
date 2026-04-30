/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
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
  totalLikes: 0,
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
        status={{ ...boostedStatus, actor: null }}
        onShowAttachment={jest.fn()}
      />
    )

    expect(
      screen.getByText('Boosted by @booster@remote.example')
    ).toBeInTheDocument()
  })
})
