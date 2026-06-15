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

import { StatusBox } from './StatusBox'

const mockPush = vi.fn()

vi.mock('@/lib/components/posts/collapsible-content', () => ({
  CollapsibleContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  )
}))

vi.mock('./FitnessStatusDetail', () => ({
  FitnessStatusDetail: () => null
}))

vi.mock('./StatusLikes', () => ({
  StatusLikes: () => <div data-testid="status-likes" />
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: vi.fn()
  })
}))

vi.mock('@/lib/client', () => ({
  votePoll: vi.fn()
}))

vi.mock('@/lib/utils/getStatusDetailPathClient', () => ({
  getStatusDetailPathClient: vi.fn()
}))

const mockVotePoll = vi.mocked(votePoll)
const mockGetStatusDetailPathClient = vi.mocked(getStatusDetailPathClient)

describe('StatusBox', () => {
  beforeEach(() => {
    mockPush.mockClear()
    mockVotePoll.mockReset()
    mockGetStatusDetailPathClient.mockResolvedValue('/@llun/poll-1')
  })

  it('only opens comment status detail pages from the timestamp', async () => {
    render(
      <StatusBox
        host="activities.local"
        currentActor={pollStatusFixture.actor}
        currentTime={pollStatusCurrentTime}
        status={pollStatusFixture}
        variant="comment"
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

    fireEvent.click(screen.getByRole('button', { name: /Open status by Llun/ }))

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/@llun/poll-1')
    })
  })

  it('renders the likes list on the detail view for a signed-in actor', () => {
    render(
      <StatusBox
        host="activities.local"
        currentActor={pollStatusFixture.actor}
        currentTime={pollStatusCurrentTime}
        status={pollStatusFixture}
        variant="detail"
      />
    )

    expect(screen.getByTestId('status-likes')).toBeInTheDocument()
  })

  it('hides the likes list on the detail view for logged-out visitors', () => {
    render(
      <StatusBox
        host="activities.local"
        currentActor={null}
        currentTime={pollStatusCurrentTime}
        status={pollStatusFixture}
        variant="detail"
      />
    )

    expect(screen.queryByTestId('status-likes')).not.toBeInTheDocument()
  })
})
