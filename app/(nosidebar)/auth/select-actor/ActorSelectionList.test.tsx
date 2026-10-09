/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

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
})
