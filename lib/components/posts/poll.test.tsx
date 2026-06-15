/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { votePoll } from '@/lib/client'
import { StatusPoll, StatusType } from '@/lib/types/domain/status'

import { Poll } from './poll'

vi.mock('@/lib/client', () => ({
  votePoll: vi.fn()
}))

const mockVotePoll = vi.mocked(votePoll)

const currentTime = new Date('2026-04-26T10:00:00.000Z').getTime()

const pollStatus: StatusPoll = {
  id: 'https://activities.local/statuses/poll-1',
  actorId: 'https://activities.local/actors/llun',
  actor: null,
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
  attachments: [],
  tags: [],
  choices: [
    {
      statusId: 'https://activities.local/statuses/poll-1',
      title: 'First',
      totalVotes: 0,
      createdAt: currentTime,
      updatedAt: currentTime
    },
    {
      statusId: 'https://activities.local/statuses/poll-1',
      title: 'Second',
      totalVotes: 0,
      createdAt: currentTime,
      updatedAt: currentTime
    }
  ],
  endAt: currentTime + 30_000,
  pollType: 'oneOf'
}

describe('Poll', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(currentTime))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows an error and keeps the selection when voting fails', async () => {
    mockVotePoll.mockRejectedValueOnce(new Error('vote failed'))

    render(
      <Poll
        status={pollStatus}
        currentTime={currentTime}
        currentActorId="https://activities.local/actors/llun"
      />
    )

    const firstChoice = screen.getByLabelText('First')
    fireEvent.click(firstChoice)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Vote' }))
    })

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Failed to submit vote. Please try again.'
    )
    expect(firstChoice).toBeChecked()
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
    expect(vi.getTimerCount()).toBe(1)

    act(() => {
      vi.setSystemTime(new Date(pollStatus.endAt))
      vi.advanceTimersByTime(pollStatus.endAt - currentTime)
    })

    expect(screen.getByText('Poll closed')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Vote' })
    ).not.toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('syncs poll availability when currentTime prop changes', () => {
    const { rerender } = render(
      <Poll
        status={pollStatus}
        currentTime={currentTime}
        currentActorId="https://activities.local/actors/llun"
      />
    )

    expect(screen.getByRole('button', { name: 'Vote' })).toBeInTheDocument()

    rerender(
      <Poll
        status={pollStatus}
        currentTime={pollStatus.endAt}
        currentActorId="https://activities.local/actors/llun"
      />
    )

    expect(screen.getByText('Poll closed')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Vote' })
    ).not.toBeInTheDocument()
  })

  it('does not start a timer for already closed polls', () => {
    render(
      <Poll
        status={{
          ...pollStatus,
          endAt: currentTime - 1_000
        }}
        currentTime={currentTime}
        currentActorId="https://activities.local/actors/llun"
      />
    )

    expect(screen.getByText('Poll closed')).toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(0)
  })
})
