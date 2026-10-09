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

  it('sizes md at 44px and sm at 36px and scrolls sideways on overflow', () => {
    const { rerender } = render(
      <SegmentedControl
        aria-label="Shade by"
        items={items}
        value="count"
        onValueChange={vi.fn()}
      />
    )
    expect(screen.getByRole('radio', { name: 'Activities' })).toHaveClass(
      'min-h-11'
    )
    expect(screen.getByRole('radiogroup')).toHaveClass('overflow-x-auto')

    rerender(
      <SegmentedControl
        aria-label="Shade by"
        size="sm"
        items={items}
        value="count"
        onValueChange={vi.fn()}
      />
    )
    expect(screen.getByRole('radio', { name: 'Activities' })).toHaveClass(
      'min-h-9'
    )
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

  it('paints the current link as the active segment', () => {
    render(
      <SegmentedControl
        asLinks
        aria-label="Reports"
        items={linkItems}
        value="open"
      />
    )
    expect(screen.getByRole('link', { name: 'Open' })).toHaveClass(
      'bg-primary',
      'text-primary-foreground'
    )
  })
})
