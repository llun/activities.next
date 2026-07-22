/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReactNode } from 'react'

import { votePoll } from '@/lib/client'
import {
  pollStatusCurrentTime,
  pollStatusFixture
} from '@/lib/components/posts/__fixtures__/poll-status'
import { Status, StatusType } from '@/lib/types/domain/status'
import { getStatusDetailPathClient } from '@/lib/utils/getStatusDetailPathClient'

import { Posts } from './posts'

// A boost (Announce) row wrapping the shared poll fixture as its original, with
// a distinct wrapper id per row.
const makeBoost = (announceId: string): Status =>
  ({
    id: announceId,
    actorId: 'https://remote.example/users/booster',
    actor: pollStatusFixture.actor,
    to: [],
    cc: [],
    edits: [],
    isLocalActor: false,
    createdAt: pollStatusFixture.createdAt,
    updatedAt: pollStatusFixture.updatedAt,
    type: StatusType.enum.Announce,
    originalStatus: pollStatusFixture
  }) as unknown as Status

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

vi.mock('@/lib/client', () => ({
  votePoll: vi.fn()
}))

vi.mock('@/lib/utils/getStatusDetailPathClient', () => ({
  getStatusDetailPathClient: vi.fn()
}))

// Stub the shared inline composer so this test exercises only that Posts wires
// the reply/quote/edit handlers and renders the composer for the active post —
// the composer's own behavior is covered in inline-status-composer.test.tsx.
vi.mock('./inline-status-composer', () => ({
  InlineStatusComposer: ({
    mode,
    status
  }: {
    mode: string
    status: { id: string }
  }) => (
    <div
      data-testid="inline-composer"
      data-mode={mode}
      data-status={status.id}
    />
  )
}))

const mockVotePoll = vi.mocked(votePoll)
const mockGetStatusDetailPathClient = vi.mocked(getStatusDetailPathClient)

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
        currentActor={pollStatusFixture.actor ?? undefined}
        currentTime={pollStatusCurrentTime}
        statuses={[pollStatusFixture]}
      />
    )

    const option = screen.getByLabelText('Option A')

    fireEvent.click(screen.getByText('Question'))
    expect(mockGetStatusDetailPathClient).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()

    fireEvent.click(option)

    expect(option).toBeChecked()
    expect(mockGetStatusDetailPathClient).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('opens the shared inline composer from a post action row', () => {
    // Every signed-in feed passes the same action wiring, so using an action
    // (reply here) opens the shared composer for that post regardless of page.
    render(
      <Posts
        host="activities.local"
        currentActor={pollStatusFixture.actor ?? undefined}
        currentTime={pollStatusCurrentTime}
        statuses={[pollStatusFixture]}
        showActions
      />
    )

    expect(screen.queryByTestId('inline-composer')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Reply to post/ }))

    const composer = screen.getByTestId('inline-composer')
    expect(composer).toHaveAttribute('data-mode', 'reply')
    expect(composer).toHaveAttribute('data-status', pollStatusFixture.id)
  })

  it('offers no composer affordance when actions are off', () => {
    render(
      <Posts
        host="activities.local"
        currentActor={pollStatusFixture.actor ?? undefined}
        currentTime={pollStatusCurrentTime}
        statuses={[pollStatusFixture]}
      />
    )

    expect(
      screen.queryByRole('button', { name: /Reply to post/ })
    ).not.toBeInTheDocument()
    expect(screen.queryByTestId('inline-composer')).not.toBeInTheDocument()
  })

  it('renders only one composer when two rows share the same underlying status', () => {
    // Two accounts you follow boosting the same post yields two Announce rows
    // with one original. Anchoring the composer on the wrapper row id (not the
    // unwrapped id) keeps a reply from opening under both rows.
    render(
      <Posts
        host="activities.local"
        currentActor={pollStatusFixture.actor ?? undefined}
        currentTime={pollStatusCurrentTime}
        statuses={[
          makeBoost('https://remote.example/users/booster/boost-a/activity'),
          makeBoost('https://remote.example/users/booster/boost-b/activity')
        ]}
        showActions
      />
    )

    fireEvent.click(screen.getAllByRole('button', { name: /Reply to post/ })[0])

    expect(screen.getAllByTestId('inline-composer')).toHaveLength(1)
  })

  it('opens the status detail page from the timestamp', async () => {
    render(
      <Posts
        host="activities.local"
        currentTime={pollStatusCurrentTime}
        statuses={[pollStatusFixture]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Open status by Llun/ }))

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/@llun/poll-1')
    })
  })
})
