/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { switchActor } from '@/lib/client'
import { createDeferred } from '@/lib/testing/deferred'

import { ActorSelectionList } from './ActorSelectionList'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() })
}))

vi.mock('@/lib/client', () => ({
  switchActor: vi.fn()
}))

const actors = [
  {
    id: 'https://activities.local/users/alice',
    username: 'alice',
    domain: 'activities.local',
    name: 'Alice',
    iconUrl: null
  },
  {
    id: 'https://activities.local/users/bob',
    username: 'bob',
    domain: 'activities.local',
    name: null,
    iconUrl: null
  }
]

describe('ActorSelectionList', () => {
  it('lists each actor with its name and handle', () => {
    render(<ActorSelectionList actors={actors} />)

    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('@alice@activities.local')).toBeInTheDocument()
    expect(screen.getByText('@bob@activities.local')).toBeInTheDocument()
  })

  it('announces one status while an actor is being switched to, without text on screen', async () => {
    const pending = createDeferred<boolean>()
    vi.mocked(switchActor).mockReturnValue(pending.promise)
    render(<ActorSelectionList actors={actors} />)

    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    fireEvent.click(screen.getByRole('button', { name: /Alice/ }))

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Switching account')
    )
    expect(screen.getAllByRole('status')).toHaveLength(1)
    // The status sits beside the buttons, so it does not rename them.
    expect(
      screen.getByRole('button', { name: /Alice/ })
    ).not.toHaveAccessibleName(/Switching account/)
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument()
    // The rest of the list waits for the switch to finish.
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled()
    }

    pending.resolve(false)
    await waitFor(() =>
      expect(screen.getByRole('status')).toBeEmptyDOMElement()
    )
  })
})
