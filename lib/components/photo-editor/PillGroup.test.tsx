/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { PillGroup } from './PillGroup'

const items = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' }
]

describe('PillGroup', () => {
  it('renders every item as a radio and wraps instead of scrolling', () => {
    render(
      <PillGroup
        aria-label="Pick"
        items={items}
        value="b"
        onValueChange={vi.fn()}
      />
    )
    const group = screen.getByRole('radiogroup', { name: 'Pick' })
    expect(group).toHaveClass('flex-wrap')
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByRole('radio', { name: 'Beta' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Beta' })).toHaveClass(
      'max-md:min-h-10'
    )
  })

  it('is one tab stop and moves with the arrow keys', () => {
    const onValueChange = vi.fn()
    render(
      <PillGroup
        aria-label="Pick"
        items={items}
        value="c"
        onValueChange={onValueChange}
      />
    )
    expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveAttribute(
      'tabindex',
      '-1'
    )
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Gamma' }), {
      key: 'ArrowRight'
    })
    expect(onValueChange).toHaveBeenCalledWith('a')
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Gamma' }), {
      key: 'Home'
    })
    expect(onValueChange).toHaveBeenLastCalledWith('a')
  })
})
