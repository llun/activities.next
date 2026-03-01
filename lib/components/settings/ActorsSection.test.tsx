/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { ActorsSection } from './ActorsSection'

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({
    refresh: jest.fn()
  }))
}))

jest.mock('@/lib/components/actor-switcher', () => ({
  AddActorDialog: () => null
}))

describe('ActorsSection', () => {
  const actors = [
    {
      id: 'actor-1',
      username: 'alice',
      domain: 'activities.local',
      name: 'Alice'
    },
    {
      id: 'actor-2',
      username: 'bob',
      domain: 'activities.local',
      name: 'Bob'
    }
  ]

  it('shows the current actor after reload even when default differs', () => {
    render(
      <ActorsSection
        currentActor={actors[1]}
        actors={actors}
        currentDefault={actors[0].id}
      />
    )

    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('(current)')).toBeInTheDocument()
  })

  it('falls back to the first actor when current actor is missing', () => {
    render(
      <ActorsSection
        currentActor={{
          id: 'missing-actor',
          username: 'charlie',
          domain: 'activities.local',
          name: 'Charlie'
        }}
        actors={actors}
        currentDefault={actors[0].id}
      />
    )

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.queryByText('(current)')).not.toBeInTheDocument()
  })
})
