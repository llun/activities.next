/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { CalendarTooltip, useCalendarTooltip } from './CalendarTooltip'

const Harness = () => {
  const tooltip = useCalendarTooltip({ suppressedDate: null })
  const target = tooltip.target
  return (
    <>
      <div
        data-testid="grid"
        data-tooltip-boundary=""
        data-tooltip-inset-start="56"
        {...tooltip.containerProps}
      >
        <button type="button" data-date="2026-10-02" data-state="active">
          two
        </button>
      </div>
      <CalendarTooltip
        target={target}
        content={target ? { title: 't', detail: 'd' } : null}
      />
    </>
  )
}

const rect = (left: number, top: number): DOMRect =>
  ({
    left,
    top,
    right: left + 18,
    bottom: top + 18,
    width: 18,
    height: 18,
    x: left,
    y: top,
    toJSON: () => ({})
  }) as DOMRect

const tip = () =>
  document.body.querySelector<HTMLElement>('[data-slot="calendar-tooltip"]')!

const focusTwo = () =>
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
    )
    screen.getByRole('button', { name: 'two' }).focus()
  })

describe('calendar tooltip follows its cell', () => {
  let current = rect(400, 300)
  beforeEach(() => {
    vi.useFakeTimers()
    current = rect(400, 300)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset.date) return current
        if (this.dataset.tooltipBoundary !== undefined)
          return { ...rect(100, 0), right: 900 } as DOMRect
        return rect(0, 0)
      }
    )
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('repositions on a scroll of an inner scroller', () => {
    render(<Harness />)
    focusTwo()
    const before = tip().style.transform
    current = rect(500, 400)
    fireEvent.scroll(screen.getByTestId('grid'))
    act(() => vi.advanceTimersByTime(20))
    expect(tip().style.transform).not.toBe(before)
  })

  it('repositions on resize', () => {
    render(<Harness />)
    focusTwo()
    const before = tip().style.transform
    current = rect(500, 400)
    fireEvent(window, new Event('resize'))
    act(() => vi.advanceTimersByTime(20))
    expect(tip().style.transform).not.toBe(before)
  })

  it('hides once the cell scrolls under the inset labels', () => {
    render(<Harness />)
    focusTwo()
    expect(tip().dataset.visible).toBe('true')
    current = rect(100 + 56 - 18 - 5, 300) // right = 133 <= 156
    fireEvent.scroll(screen.getByTestId('grid'))
    act(() => vi.advanceTimersByTime(20))
    expect(tip().dataset.visible).toBe('false')
  })

  it('stays visible with a cell just clear of the inset labels', () => {
    render(<Harness />)
    focusTwo()
    current = rect(100 + 56 - 10, 300) // right = 164 > 156, left 146
    fireEvent.scroll(screen.getByTestId('grid'))
    act(() => vi.advanceTimersByTime(20))
    expect(tip().dataset.visible).toBe('true')
  })
})
