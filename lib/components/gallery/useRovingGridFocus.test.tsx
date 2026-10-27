/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import { type FC } from 'react'
import { describe, expect, it } from 'vitest'

import { useRovingGridFocus } from '@/lib/components/gallery/useRovingGridFocus'

const Grid: FC<{
  enabled?: boolean
  count: number
  ariaDisabledFirst?: boolean
}> = ({ enabled = true, count, ariaDisabledFirst = false }) => {
  const focus = useRovingGridFocus({ enabled, count })
  return (
    <div
      data-grid="true"
      style={{ gridTemplateColumns: '1fr 1fr 1fr' }}
      onKeyDown={focus.onKeyDown}
    >
      {Array.from({ length: count }, (_, index) => (
        <button
          key={index}
          type="button"
          data-grid-index={index}
          tabIndex={focus.getTabIndex(index)}
          aria-disabled={ariaDisabledFirst && index === 0 ? 'true' : undefined}
          onClick={() => focus.onFocusTile(index)}
          onFocus={() => focus.onFocusTile(index)}
        >
          Tile {index}
        </button>
      ))}
    </div>
  )
}

const GroupedGrid: FC<{ groupSizes: number[] }> = ({ groupSizes }) => {
  const count = groupSizes.reduce((sum, size) => sum + size, 0)
  const focus = useRovingGridFocus({ enabled: true, count, groupSizes })
  let start = 0

  return (
    <div onKeyDown={focus.onKeyDown}>
      {groupSizes.map((size, groupIndex) => {
        const groupStart = start
        start += size
        return (
          <ul
            key={groupIndex}
            data-grid="true"
            style={{ gridTemplateColumns: '1fr 1fr 1fr' }}
          >
            {Array.from({ length: size }, (_, localIndex) => {
              const index = groupStart + localIndex
              return (
                <li key={index}>
                  <button
                    type="button"
                    data-grid-index={index}
                    tabIndex={focus.getTabIndex(index)}
                    onFocus={() => focus.onFocusTile(index)}
                  >
                    Tile {index}
                  </button>
                </li>
              )
            })}
          </ul>
        )
      })}
    </div>
  )
}

const tile = (index: number) =>
  screen.getByRole('button', { name: `Tile ${index}` })

const tabIndexes = (): (string | null)[] =>
  screen.getAllByRole('button').map((button) => button.getAttribute('tabindex'))

describe('useRovingGridFocus', () => {
  it('gives only one tile a tabIndex of 0', () => {
    render(<Grid count={4} />)

    expect(tabIndexes()).toEqual(['0', '-1', '-1', '-1'])
  })

  it('moves focus and the tab stop with ArrowRight', () => {
    render(<Grid count={4} />)

    fireEvent.keyDown(tile(0), { key: 'ArrowRight' })

    expect(tile(1)).toHaveFocus()
    expect(tabIndexes()).toEqual(['-1', '0', '-1', '-1'])
  })

  it('clamps ArrowRight at the last tile', () => {
    render(<Grid count={4} />)
    fireEvent.click(tile(3))

    fireEvent.keyDown(tile(3), { key: 'ArrowRight' })

    expect(tile(3)).toHaveFocus()
    expect(tabIndexes()).toEqual(['-1', '-1', '-1', '0'])
  })

  it('moves by the rendered column count with ArrowDown', () => {
    render(<Grid count={6} />)

    fireEvent.keyDown(tile(0), { key: 'ArrowDown' })

    expect(tile(3)).toHaveFocus()
    expect(tabIndexes()).toEqual(['-1', '-1', '-1', '0', '-1', '-1'])
  })

  it('moves down from a one-photo day to the first photo of the next day', () => {
    render(<GroupedGrid groupSizes={[1, 5]} />)

    fireEvent.keyDown(tile(0), { key: 'ArrowDown' })

    expect(tile(1)).toHaveFocus()
  })

  it('moves up from column two to the previous short day, clamped to its length', () => {
    render(<GroupedGrid groupSizes={[1, 5]} />)
    tile(3).focus()

    fireEvent.keyDown(tile(3), { key: 'ArrowUp' })

    expect(tile(0)).toHaveFocus()
  })

  it('makes a clicked tile the active one', () => {
    render(<Grid count={4} />)

    fireEvent.click(tile(2))

    expect(tabIndexes()).toEqual(['-1', '-1', '0', '-1'])
  })

  it('clamps the active tile when the count shrinks', () => {
    const { rerender } = render(<Grid count={4} />)
    fireEvent.click(tile(3))

    rerender(<Grid count={2} />)

    expect(tabIndexes()).toEqual(['-1', '0'])
  })

  it('leaves the tab order alone when disabled', () => {
    render(<Grid enabled={false} count={4} />)

    expect(tabIndexes()).toEqual([null, null, null, null])
  })

  it('keeps one tab stop on an aria-disabled first tile and arrows past it', () => {
    // Blocked / in-album tiles render aria-disabled, not disabled, so they
    // stay focusable: the hook treats them like any other tile.
    render(<Grid count={3} ariaDisabledFirst />)

    expect(tile(0)).toHaveAttribute('aria-disabled', 'true')
    expect(tabIndexes()).toEqual(['0', '-1', '-1'])

    fireEvent.keyDown(tile(0), { key: 'ArrowRight' })

    expect(tile(1)).toHaveFocus()
    expect(tabIndexes()).toEqual(['-1', '0', '-1'])
  })

  it.each(['altKey', 'metaKey', 'ctrlKey'] as const)(
    'leaves a modified arrow key to the browser (%s)',
    (modifier) => {
      render(<Grid count={4} />)
      fireEvent.click(tile(1))
      tile(1).focus()

      const event = createEvent.keyDown(tile(1), {
        key: 'ArrowLeft',
        [modifier]: true
      })
      fireEvent(tile(1), event)

      expect(event.defaultPrevented).toBe(false)
      expect(tile(1)).toHaveFocus()
      expect(tabIndexes()).toEqual(['-1', '0', '-1', '-1'])
    }
  )
})
