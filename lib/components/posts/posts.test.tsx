/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReactNode } from 'react'

import { votePoll } from '@/lib/client'
import { StatusPoll, StatusType } from '@/lib/types/domain/status'
import { getStatusDetailPathClient } from '@/lib/utils/getStatusDetailPathClient'

import { Posts } from './posts'

jest.mock('./collapsible-content', () => ({
  CollapsibleContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  )
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush
  })
}))

jest.mock('@/lib/client', () => ({
  votePoll: jest.fn()
}))

jest.mock('@/lib/utils/getStatusDetailPathClient', () => ({
  getStatusDetailPathClient: jest.fn()
}))

const mockPush = jest.fn()
const mockVotePoll = jest.mocked(votePoll)
const mockGetStatusDetailPathClient = jest.mocked(getStatusDetailPathClient)

const currentTime = new Date('2026-04-26T10:00:00.000Z').getTime()

const pollStatus: StatusPoll = {
  id: 'https://activities.local/users/llun/statuses/poll-1',
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
  type: StatusType.enum.Poll,
  url: 'https://activities.local/@llun/poll-1',
  text: 'Question',
  summary: null,
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  totalLikes: 0,
  totalShares: 0,
  tags: [],
  endAt: new Date('2026-12-31T10:00:00.000Z').getTime(),
  choices: [
    {
      title: 'Option A',
      totalVotes: 2,
      statusId: 'https://activities.local/users/llun/statuses/poll-1',
      createdAt: currentTime,
      updatedAt: currentTime
    },
    {
      title: 'Option B',
      totalVotes: 1,
      statusId: 'https://activities.local/users/llun/statuses/poll-1',
      createdAt: currentTime,
      updatedAt: currentTime
    }
  ],
  pollType: 'oneOf'
}

describe('Posts', () => {
  beforeEach(() => {
    mockPush.mockClear()
    mockVotePoll.mockReset()
    mockGetStatusDetailPathClient.mockResolvedValue('/@llun/poll-1')
  })

  it('does not open the status detail page when poll content is clicked', async () => {
    render(
      <Posts
        host="activities.local"
        currentActor={pollStatus.actor ?? undefined}
        currentTime={currentTime}
        statuses={[pollStatus]}
      />
    )

    const option = screen.getByLabelText('Option A')

    fireEvent.click(option)

    expect(option).toBeChecked()
    expect(mockGetStatusDetailPathClient).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('opens the status detail page from the timestamp', async () => {
    render(
      <Posts
        host="activities.local"
        currentTime={currentTime}
        statuses={[pollStatus]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Open status by Llun/ }))

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/@llun/poll-1')
    })
  })
})
