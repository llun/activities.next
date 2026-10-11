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

  describe('with no value', () => {
    it('checks nothing and keeps the first pill as the tab stop', () => {
      render(
        <PillGroup
          aria-label="Pick"
          items={items}
          value={null}
          onValueChange={vi.fn()}
        />
      )
      expect(screen.queryAllByRole('radio', { checked: true })).toEqual([])
      expect(
        screen.getAllByRole('radio').map((radio) => radio.tabIndex)
      ).toEqual([0, -1, -1])
    })

    it('moves on from the focused pill, like any radio group', () => {
      const onValueChange = vi.fn()
      render(
        <PillGroup
          aria-label="Pick"
          items={items}
          value={null}
          onValueChange={onValueChange}
        />
      )
      const first = screen.getByRole('radio', { name: 'Alpha' })

      fireEvent.keyDown(first, { key: 'ArrowRight' })
      expect(onValueChange).toHaveBeenLastCalledWith('b')

      fireEvent.keyDown(first, { key: 'ArrowLeft' })
      expect(onValueChange).toHaveBeenLastCalledWith('c')

      fireEvent.keyDown(screen.getByRole('radio', { name: 'Gamma' }), {
        key: 'ArrowRight'
      })
      expect(onValueChange).toHaveBeenLastCalledWith('a')

      fireEvent.keyDown(first, { key: 'End' })
      expect(onValueChange).toHaveBeenLastCalledWith('c')
    })

    it('still chooses a pill on click', () => {
      const onValueChange = vi.fn()
      render(
        <PillGroup
          aria-label="Pick"
          items={items}
          value={null}
          onValueChange={onValueChange}
        />
      )
      fireEvent.click(screen.getByRole('radio', { name: 'Beta' }))
      expect(onValueChange).toHaveBeenCalledWith('b')
    })
  })
})
