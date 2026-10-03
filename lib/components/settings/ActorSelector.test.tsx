/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { ActorSelector } from './ActorSelector'

const actors = [
  { id: 'actor-1', username: 'anna', domain: 'llun.test', name: 'Anna' },
  { id: 'actor-2', username: 'bob', domain: 'llun.test', name: null }
]

describe('ActorSelector', () => {
  it('renders nothing for an account with a single actor', () => {
    const { container } = render(
      <ActorSelector actors={[actors[0]]} selectedActorId="actor-1" />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('is the shared Select, labelled "Actor", on the selected actor', () => {
    render(<ActorSelector actors={actors} selectedActorId="actor-2" />)

    const select = screen.getByLabelText('Actor')
    expect(select.tagName).toBe('SELECT')
    expect(select).toHaveAttribute('data-slot', 'select')
    expect(select).toHaveAttribute('id', 'actorSelect')
    expect(select).toHaveValue('actor-2')
    expect(select).toHaveClass('appearance-none', 'pr-8')
    expect(
      screen.getAllByRole('option').map((option) => option.textContent)
    ).toEqual(['@anna@llun.test (Anna)', '@bob@llun.test'])
  })

  it('posts the selected actor through the hidden field only', () => {
    const { container } = render(
      <form>
        <ActorSelector actors={actors} selectedActorId="actor-2" />
      </form>
    )

    // The select navigates on change and has no name of its own: the form
    // submits `actorId` through the hidden input, exactly one field.
    const form = container.querySelector('form') as HTMLFormElement
    expect([...new FormData(form).entries()]).toEqual([['actorId', 'actor-2']])
  })
})
