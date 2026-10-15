/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { Globe } from 'lucide-react'
import { useState } from 'react'

import { RadioGroup } from '@/lib/components/ui/radio-group'

import { RadioCard } from './RadioCard'

const Harness = () => {
  const [value, setValue] = useState('a')
  return (
    <RadioGroup value={value} onValueChange={setValue} aria-label="Pick one">
      <RadioCard value="a" title="Alpha" hint="First choice" icon={Globe} />
      <RadioCard value="b" title="Beta" hint="Second choice" />
    </RadioGroup>
  )
}

describe('RadioCard', () => {
  it('names the radio by its title and describes it by its hint', () => {
    render(<Harness />)
    const radio = screen.getByRole('radio', { name: 'Alpha' })
    expect(radio).toHaveAccessibleDescription('First choice')
    expect(radio).toBeChecked()
  })

  it('selects when the card text is clicked', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Second choice'))
    expect(screen.getByRole('radio', { name: 'Beta' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Alpha' })).not.toBeChecked()
  })

  it('marks the chosen card for its tinted border and background', () => {
    render(<Harness />)
    const cards = document.querySelectorAll('[data-slot="radio-card"]')
    expect(cards[0]).toHaveClass('has-data-[state=checked]:border-primary')
    expect(cards[0].querySelector('[data-state="checked"]')).toBeInTheDocument()
    expect(
      cards[1].querySelector('[data-state="checked"]')
    ).not.toBeInTheDocument()
  })

  it('keeps a disabled card from being chosen', () => {
    render(
      <RadioGroup defaultValue="a" aria-label="Pick one">
        <RadioCard value="a" title="Alpha" />
        <RadioCard value="b" title="Beta" disabled />
      </RadioGroup>
    )
    expect(screen.getByRole('radio', { name: 'Beta' })).toBeDisabled()
  })
})
