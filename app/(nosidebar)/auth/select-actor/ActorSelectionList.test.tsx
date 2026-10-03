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

  it('draws each actor monogram on the neutral tokens, not Tailwind grays', () => {
    render(<ActorSelectionList actors={actors} />)

    // The same fill and letter as the sidebar footer's monogram: the skeleton
    // fill, a semibold muted letter, and the input fill in dark.
    const rows = screen.getAllByRole('button')
    for (const [index, initial] of ['A', 'B'].entries()) {
      const monogram = rows[index].querySelector(
        '[data-slot="avatar-fallback"]'
      )
      expect(monogram).toHaveTextContent(initial)
      expect(monogram).toHaveClass(
        'bg-(--skeleton)',
        'font-semibold',
        'text-muted-foreground',
        'dark:bg-input'
      )
      expect(monogram?.className).not.toMatch(/gray-/)
    }
  })
})
