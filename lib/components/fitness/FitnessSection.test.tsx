/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { Bike } from 'lucide-react'

import { FitnessSection } from './FitnessSection'

describe('FitnessSection', () => {
  it('names the section by its heading', () => {
    render(
      <FitnessSection title="Bikes">
        <p>Body</p>
      </FitnessSection>
    )
    expect(screen.getByRole('region', { name: 'Bikes' })).toBeInTheDocument()
  })

  it('draws the subject icon before the heading, hidden from screen readers', () => {
    const { container } = render(
      <FitnessSection title="Bikes" icon={Bike}>
        <p>Body</p>
      </FitnessSection>
    )
    const heading = screen.getByRole('heading', { name: 'Bikes' })
    const icon = heading.previousElementSibling
    expect(icon?.tagName.toLowerCase()).toBe('svg')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelectorAll('svg')).toHaveLength(1)
  })

  it('draws no icon when none is given', () => {
    const { container } = render(
      <FitnessSection title="Bikes">
        <p>Body</p>
      </FitnessSection>
    )
    expect(container.querySelector('svg')).toBeNull()
  })
})
