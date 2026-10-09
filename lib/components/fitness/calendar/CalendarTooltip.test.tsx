/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { FC } from 'react'

import { DateKey } from '@/lib/fitness/calendar/localDay'

import {
  Box,
  CalendarTooltip,
  placeTooltip,
  useCalendarTooltip
} from './CalendarTooltip'
import { key } from './calendarTestDoubles'

const box = (left: number, top: number, width = 18, height = 18): Box => ({
  left,
  top,
  right: left + width,
  bottom: top + height
})

const viewport = { width: 1000, height: 800 }
const size = { width: 200, height: 40 }

describe('placeTooltip', () => {
  it('sits above the cell, centred, and clear of it', () => {
    const anchor = box(400, 300)

    const placement = placeTooltip({ anchor, size, viewport })

    expect(placement.side).toBe('top')
    expect(placement.x).toBe(409 - 100)
    expect(placement.y + size.height).toBeLessThanOrEqual(anchor.top)
  })

  it('flips below when there is no room above', () => {
    const anchor = box(400, 20)

    const placement = placeTooltip({ anchor, size, viewport })

    expect(placement.side).toBe('bottom')
    expect(placement.y).toBeGreaterThanOrEqual(anchor.bottom)
  })

  it('flips below when above would cover the month labels', () => {
    const labels = box(380, 270, 60, 14)
    const anchor = box(400, 300)

    const placement = placeTooltip({ anchor, size, viewport, avoid: [labels] })

    expect(placement.side).toBe('bottom')
    expect(placement.y).toBeGreaterThanOrEqual(anchor.bottom)
  })

  it('stays above when the labels are off to the side', () => {
    const labels = box(10, 270, 60, 14)

    const placement = placeTooltip({
      anchor: box(400, 300),
      size,
      viewport,
      avoid: [labels]
    })

    expect(placement.side).toBe('top')
  })

  it('clamps to the viewport with an 8px margin on both sides', () => {
    expect(placeTooltip({ anchor: box(0, 300), size, viewport }).x).toBe(8)
    expect(placeTooltip({ anchor: box(990, 300), size, viewport }).x).toBe(
      viewport.width - size.width - 8
    )
  })

  it('takes the roomier side, kept inside the viewport, when neither fits', () => {
    const tall = { width: 200, height: 500 }

    const near = placeTooltip({
      anchor: box(400, 100),
      size: tall,
      viewport: { width: 1000, height: 600 }
    })
    const far = placeTooltip({
      anchor: box(400, 450),
      size: tall,
      viewport: { width: 1000, height: 600 }
    })

    expect(near.side).toBe('bottom')
    expect(near.y + tall.height).toBeLessThanOrEqual(600)
    expect(far.side).toBe('top')
    expect(far.y).toBeGreaterThanOrEqual(8)
  })
})

const content = (date: DateKey) => ({
  title: `Title ${date}`,
  detail: `Detail ${date}`
})

const Harness: FC<{ pinned?: DateKey | null }> = ({ pinned = null }) => {
  const tooltip = useCalendarTooltip({ suppressedDate: pinned })
  const target = tooltip.target
  return (
    <>
      <div
        data-testid="grid"
        {...tooltip.containerProps}
        onScroll={tooltip.onScroll}
      >
        <button type="button" data-date="2026-10-01" data-state="active">
          one
        </button>
        <button type="button" data-date="2026-10-02" data-state="active">
          two
        </button>
        <button type="button" data-date="2026-10-20" data-state="upcoming">
          later
        </button>
      </div>
      <CalendarTooltip
        target={target}
        content={target ? content(target.date) : null}
      />
    </>
  )
}

const tooltip = () =>
  document.body.querySelector<HTMLElement>('[data-slot="calendar-tooltip"]')

const isShown = () => tooltip()?.dataset.visible === 'true'
// `:focus-visible` follows the last input: a key press makes the next focus
// "visible", as it is when a person tabs or arrows onto a cell.
const keyboardFocus = (element: HTMLElement) =>
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
    )
    element.focus()
  })

const hover = (name: string, pointerType = 'mouse') =>
  fireEvent.pointerOver(screen.getByRole('button', { name }), { pointerType })

describe('calendar tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows after a 150ms hover delay, not before', () => {
    render(<Harness />)

    hover('one')
    act(() => vi.advanceTimersByTime(149))
    expect(isShown()).toBe(false)

    act(() => vi.advanceTimersByTime(1))
    expect(isShown()).toBe(true)
    expect(tooltip()).toHaveTextContent('Title 2026-10-01')
    expect(tooltip()).toHaveTextContent('Detail 2026-10-01')
  })

  it('shows at once on keyboard focus, with no delay', () => {
    render(<Harness />)

    keyboardFocus(screen.getByRole('button', { name: 'two' }))

    expect(isShown()).toBe(true)
    expect(tooltip()).toHaveTextContent('Title 2026-10-02')
  })

  it('never shows for a touch pointer', () => {
    render(<Harness />)

    hover('one', 'touch')
    act(() => vi.advanceTimersByTime(500))

    expect(tooltip()).toBeNull()
  })

  it('is suppressed for the pinned day, by hover and by focus', () => {
    render(<Harness pinned={key('2026-10-01')} />)

    hover('one')
    act(() => vi.advanceTimersByTime(500))
    expect(tooltip()).toBeNull()

    keyboardFocus(screen.getByRole('button', { name: 'one' }))
    expect(tooltip()).toBeNull()

    keyboardFocus(screen.getByRole('button', { name: 'two' }))
    expect(isShown()).toBe(true)
  })

  it('hides when the pinned day becomes the hovered one', () => {
    const { rerender } = render(<Harness />)
    hover('one')
    act(() => vi.advanceTimersByTime(150))
    expect(isShown()).toBe(true)

    rerender(<Harness pinned={key('2026-10-01')} />)

    expect(isShown()).toBe(false)
  })

  it('does not describe a day that is not active', () => {
    render(<Harness />)

    hover('later')
    act(() => vi.advanceTimersByTime(500))

    expect(tooltip()).toBeNull()
  })

  it('hides when the pointer leaves the grid', () => {
    render(<Harness />)
    hover('one')
    act(() => vi.advanceTimersByTime(150))

    fireEvent.pointerLeave(screen.getByTestId('grid'))

    expect(isShown()).toBe(false)
  })

  it('cancels a pending hover when the pointer leaves first', () => {
    render(<Harness />)
    hover('one')

    fireEvent.pointerLeave(screen.getByTestId('grid'))
    act(() => vi.advanceTimersByTime(500))

    expect(tooltip()).toBeNull()
  })

  it('hides when the pointer moves onto a day that is not active', () => {
    render(<Harness />)
    hover('one')
    act(() => vi.advanceTimersByTime(150))
    expect(isShown()).toBe(true)
    hover('later')
    expect(isShown()).toBe(false)
  })

  it('stays up while the pointer moves within the same cell', () => {
    render(<Harness />)
    hover('one')
    act(() => vi.advanceTimersByTime(150))
    hover('one')
    expect(isShown()).toBe(true)
  })

  it('hides on a gap between cells and stays hidden', () => {
    render(<Harness />)
    hover('one')
    act(() => vi.advanceTimersByTime(150))
    fireEvent.pointerOver(screen.getByTestId('grid'), { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(500))
    expect(isShown()).toBe(false)
  })

  it('lets keyboard focus replace a pending hover', () => {
    render(<Harness />)
    hover('one')
    keyboardFocus(screen.getByRole('button', { name: 'two' }))
    act(() => vi.advanceTimersByTime(500))
    expect(tooltip()).toHaveTextContent('Title 2026-10-02')
  })

  it('hides on blur and on Escape', () => {
    render(<Harness />)
    const one = screen.getByRole('button', { name: 'one' })
    keyboardFocus(one)
    expect(isShown()).toBe(true)

    act(() => one.blur())
    expect(isShown()).toBe(false)

    keyboardFocus(one)
    fireEvent.keyDown(one, { key: 'Escape' })
    expect(isShown()).toBe(false)
  })

  it('hides a hover tooltip when the grid scrolls, but keeps a focus one', () => {
    render(<Harness />)
    hover('one')
    act(() => vi.advanceTimersByTime(150))
    fireEvent.scroll(screen.getByTestId('grid'))
    expect(isShown()).toBe(false)

    keyboardFocus(screen.getByRole('button', { name: 'two' }))
    fireEvent.scroll(screen.getByTestId('grid'))
    expect(isShown()).toBe(true)
  })

  it('is hidden from assistive technology: the cells already carry the words', () => {
    render(<Harness />)
    keyboardFocus(screen.getByRole('button', { name: 'one' }))

    expect(tooltip()).toHaveAttribute('aria-hidden', 'true')
  })
})
