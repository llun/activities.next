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

  it('hides the whole section from assistive tech only when asked', () => {
    const { rerender } = render(
      <Section title="Bikes" aria-hidden>
        <p>Body</p>
      </Section>
    )
    expect(document.querySelector('section')).toHaveAttribute(
      'aria-hidden',
      'true'
    )

    rerender(
      <Section title="Bikes">
        <p>Body</p>
      </Section>
    )
    expect(document.querySelector('section')).not.toHaveAttribute('aria-hidden')
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

  it('shows the meta, description and actions', () => {
    render(
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
  })

  it('takes an anchor id for in-page links', () => {
    render(
      <Section title="Laps" id="laps">
        <p>Body</p>
      </Section>
    )
    expect(screen.getByRole('region', { name: 'Laps' })).toHaveAttribute(
      'id',
      'laps'
    )
  })

  it('puts a given headingId on the heading, so a control inside can name itself', () => {
    render(
      <Section title="Profile fields" headingId="fields-heading">
        <div role="group" aria-labelledby="fields-heading" />
      </Section>
    )
    expect(
      screen.getByRole('heading', { name: 'Profile fields' })
    ).toHaveAttribute('id', 'fields-heading')
    expect(
      screen.getByRole('group', { name: 'Profile fields' })
    ).toBeInTheDocument()
  })
})
