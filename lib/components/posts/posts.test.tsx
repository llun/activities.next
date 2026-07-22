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
import { getStatusDetailPathClient } from '@/lib/utils/getStatusDetailPathClient'

import { Posts } from './posts'

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
