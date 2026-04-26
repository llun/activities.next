/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, render, screen } from '@testing-library/react'

import { StatusPoll, StatusType } from '@/lib/types/domain/status'

import { Poll } from './poll'

jest.mock('@/lib/client', () => ({
  votePoll: jest.fn()
}))

const currentTime = new Date('2026-04-26T10:00:00.000Z')

const pollStatus: StatusPoll = {
  id: 'https://activities.local/statuses/poll-1',
  actorId: 'https://activities.local/actors/llun',
  actor: null,
  to: [],
  cc: [],
  edits: [],
  isLocalActor: true,
  createdAt: currentTime.getTime(),
  updatedAt: currentTime.getTime(),
  type: StatusType.enum.Poll,
  url: 'https://activities.local/@llun/poll-1',
  text: 'Question',
  summary: null,
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  totalLikes: 0,
  attachments: [],
  tags: [],
  choices: [
    {
      statusId: 'https://activities.local/statuses/poll-1',
      title: 'First',
      totalVotes: 0,
      createdAt: currentTime.getTime(),
      updatedAt: currentTime.getTime()
    },
    {
      statusId: 'https://activities.local/statuses/poll-1',
      title: 'Second',
      totalVotes: 0,
      createdAt: currentTime.getTime(),
      updatedAt: currentTime.getTime()
    }
  ],
  endAt: currentTime.getTime() + 30_000,
  pollType: 'oneOf'
}

describe('Poll', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(currentTime)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('updates poll availability when the poll reaches its end time', () => {
    render(
      <Poll
        status={pollStatus}
        currentTime={currentTime}
        currentActorId="https://activities.local/actors/llun"
      />
    )

    expect(screen.getByRole('button', { name: 'Vote' })).toBeInTheDocument()
    expect(jest.getTimerCount()).toBe(1)

    act(() => {
      jest.setSystemTime(new Date(pollStatus.endAt))
      jest.advanceTimersByTime(pollStatus.endAt - currentTime.getTime())
    })

    expect(screen.getByText('Poll closed')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Vote' })
    ).not.toBeInTheDocument()
    expect(jest.getTimerCount()).toBe(0)
  })

  it('does not start a timer for already closed polls', () => {
    render(
      <Poll
        status={{
          ...pollStatus,
          endAt: currentTime.getTime() - 1_000
        }}
        currentTime={currentTime}
        currentActorId="https://activities.local/actors/llun"
      />
    )

    expect(screen.getByText('Poll closed')).toBeInTheDocument()
    expect(jest.getTimerCount()).toBe(0)
  })
})
