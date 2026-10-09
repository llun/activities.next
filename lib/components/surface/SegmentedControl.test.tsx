/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'

import { SegmentedControl } from './SegmentedControl'

const items = [
  { value: 'count', label: 'Activities' },
  { value: 'distance', label: 'Distance' },
  { value: 'duration', label: 'Duration' }
]

const Harness = ({ initial = 'count' }: { initial?: string }) => {
  const [value, setValue] = useState(initial)
  return (
    <SegmentedControl
      aria-label="Shade by"
      items={items}
      value={value}
      onValueChange={setValue}
    />
  )
}

describe('SegmentedControl (in-page state)', () => {
  it('is a radio group with the chosen segment checked and one tab stop', () => {
    render(<Harness initial="distance" />)
    expect(
      screen.getByRole('radiogroup', { name: 'Shade by' })
    ).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Distance' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Distance' })).toHaveAttribute(
      'tabindex',
      '0'
    )
    expect(screen.getByRole('radio', { name: 'Activities' })).toHaveAttribute(
      'tabindex',
      '-1'
    )
  })

  it('chooses on click', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('radio', { name: 'Duration' }))
    expect(screen.getByRole('radio', { name: 'Duration' })).toBeChecked()
  })

  it.each([
    ['ArrowRight', 'distance'],
    ['ArrowDown', 'distance'],
    ['ArrowLeft', 'duration'],
    ['ArrowUp', 'duration'],
    ['End', 'duration'],
    ['Home', 'count']
  ])('%s from Activities moves the choice and focus to %s', (key, expected) => {
    render(<Harness />)
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Activities' }), {
      key
    })
    const target = screen.getByRole('radio', { checked: true })
    expect(target).toHaveAttribute('data-value', expected)
    expect(target).toHaveFocus()
  })

  it('wraps from the last segment to the first', () => {
    render(<Harness initial="duration" />)
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Duration' }), {
      key: 'ArrowRight'
    })
    expect(screen.getByRole('radio', { name: 'Activities' })).toBeChecked()
  })

  it('skips disabled segments', () => {
    const onChange = vi.fn()
    render(
      <SegmentedControl
        aria-label="Shade by"
        items={[items[0], { ...items[1], disabled: true }, items[2]]}
        value="count"
        onValueChange={onChange}
      />
    )
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Activities' }), {
      key: 'ArrowRight'
    })
    expect(onChange).toHaveBeenCalledWith('duration')
  })

  describe('keyboard edge cases', () => {
    const tabStops = () =>
      screen
        .getAllByRole('radio')
        .filter((radio) => radio.getAttribute('tabindex') === '0')
        .map((radio) => radio.getAttribute('data-value'))

    it('gives an unknown value one tab stop on the first segment', () => {
      render(<Harness initial="nope" />)
      expect(screen.queryByRole('radio', { checked: true })).toBeNull()
      expect(tabStops()).toEqual(['count'])
    })

    it.each([
      ['ArrowRight', 'count'],
      ['ArrowDown', 'count'],
      ['ArrowLeft', 'duration'],
      ['ArrowUp', 'duration']
    ])('%s with an unknown value chooses %s', (key, expected) => {
      render(<Harness initial="nope" />)
      fireEvent.keyDown(screen.getByRole('radiogroup'), { key })
      expect(screen.getByRole('radio', { checked: true })).toHaveAttribute(
        'data-value',
        expected
      )
    })

    const withDisabledSelected = (onValueChange = vi.fn()) =>
      render(
        <SegmentedControl
          aria-label="Shade by"
          items={[items[0], { ...items[1], disabled: true }, items[2]]}
          value="distance"
          onValueChange={onValueChange}
        />
      )

    it('gives a disabled selected value one tab stop on the first enabled segment', () => {
      withDisabledSelected()
      expect(tabStops()).toEqual(['count'])
    })

    it('steps forward and back from a disabled selected segment', () => {
      const onValueChange = vi.fn()
      withDisabledSelected(onValueChange)
      const group = screen.getByRole('radiogroup')
      fireEvent.keyDown(group, { key: 'ArrowRight' })
      expect(onValueChange).toHaveBeenLastCalledWith('duration')
      fireEvent.keyDown(group, { key: 'ArrowLeft' })
      expect(onValueChange).toHaveBeenLastCalledWith('count')
    })

    it('does nothing when every segment is disabled', () => {
      const onValueChange = vi.fn()
      render(
        <SegmentedControl
          aria-label="Shade by"
          items={items.map((item) => ({ ...item, disabled: true }))}
          value="count"
          onValueChange={onValueChange}
        />
      )
      fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' })
      expect(onValueChange).not.toHaveBeenCalled()
      expect(tabStops()).toEqual([])
    })
  })
})

describe('SegmentedControl (asLinks)', () => {
  const linkItems = [
    { value: 'open', label: 'Open', href: '/reports?state=open' },
    { value: 'closed', label: 'Closed', href: '/reports?state=closed' }
  ]

  it('is a nav of links with the current page marked', () => {
    render(
      <SegmentedControl
        asLinks
        aria-label="Reports"
        items={linkItems}
        value="closed"
      />
    )
    expect(
      screen.getByRole('navigation', { name: 'Reports' })
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Closed' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByRole('link', { name: 'Open' })).not.toHaveAttribute(
      'aria-current'
    )
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      '/reports?state=open'
    )
    expect(screen.queryByRole('radio')).toBeNull()
  })
})
