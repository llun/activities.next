/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { ReactNode } from 'react'

import { StatusNote, StatusType } from '@/lib/types/domain/status'

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
})
