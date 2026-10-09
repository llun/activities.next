/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { Bike } from 'lucide-react'

import { Section } from './Section'

describe('Section', () => {
  it('names the section by its heading', () => {
    render(
      <Section title="Bikes">
        <p>Body</p>
      </Section>
    )
    expect(screen.getByRole('region', { name: 'Bikes' })).toBeInTheDocument()
  })

  it('draws the subject icon before the heading, hidden from screen readers', () => {
    const { container } = render(
      <Section title="Bikes" icon={Bike}>
        <p>Body</p>
      </Section>
    )
    const heading = screen.getByRole('heading', { name: 'Bikes' })
    const icon = heading.previousElementSibling
    expect(icon?.tagName.toLowerCase()).toBe('svg')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelectorAll('svg')).toHaveLength(1)
  })

  it('draws no icon when none is given', () => {
    const { container } = render(
      <Section title="Bikes">
        <p>Body</p>
      </Section>
    )
    expect(container.querySelector('svg')).toBeNull()
  })

  it('renders an h2 by default and the requested level when nested', () => {
    const { rerender } = render(
      <Section title="Bikes">
        <p>Body</p>
      </Section>
    )
    expect(
      screen.getByRole('heading', { name: 'Bikes', level: 2 })
    ).toBeInTheDocument()

    rerender(
      <Section title="Bikes" headingLevel={3}>
        <p>Body</p>
      </Section>
    )
    expect(
      screen.getByRole('heading', { name: 'Bikes', level: 3 })
    ).toBeInTheDocument()
  })

  it('shows the meta, description and actions, with no card around them', () => {
    const { container } = render(
      <Section
        title="Bikes"
        meta="3 installed"
        description="Everything you ride."
        actions={<button type="button">Add</button>}
      >
        <p>Body</p>
      </Section>
    )
    expect(screen.getByText('3 installed')).toBeInTheDocument()
    expect(screen.getByText('Everything you ride.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
    expect(container.firstElementChild?.className).not.toMatch(
      /border|shadow|rounded/
    )
  })
})
