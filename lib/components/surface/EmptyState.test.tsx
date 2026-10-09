/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { Bike } from 'lucide-react'

import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('shows the title, the hint and a hidden icon', () => {
    const { container } = render(
      <EmptyState icon={Bike} title="No bikes yet">
        Add one to start.
      </EmptyState>
    )
    expect(screen.getByText('No bikes yet')).toBeInTheDocument()
    expect(screen.getByText('Add one to start.')).toBeInTheDocument()
    expect(container.querySelector('[aria-hidden="true"] svg')).not.toBeNull()
  })

  it('renders the title as a heading when asked', () => {
    render(<EmptyState icon={Bike} title="Nothing here" titleAs="h2" />)
    expect(
      screen.getByRole('heading', { name: 'Nothing here', level: 2 })
    ).toBeInTheDocument()
  })

  it('renders an action slot', () => {
    render(
      <EmptyState
        icon={Bike}
        title="No bikes yet"
        action={<button type="button">Add a bike</button>}
      />
    )
    expect(
      screen.getByRole('button', { name: 'Add a bike' })
    ).toBeInTheDocument()
  })
})
