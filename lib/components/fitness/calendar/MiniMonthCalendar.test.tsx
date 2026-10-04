/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { DateKey, parseDateKey } from '@/lib/fitness/calendar/localDay'

import { MiniMonthCalendar, VisibleMonth } from './MiniMonthCalendar'

const key = (value: string) => parseDateKey(value) as DateKey
const TODAY = key('2026-10-04')

interface HarnessProps {
  start?: VisibleMonth
  from?: string | null
  to?: string | null
  onSelectDate?: (date: DateKey) => void
  today?: DateKey
}

function Harness({
  start = { year: 2026, month: 10 },
  from = '2026-10-01',
  to = '2026-10-04',
  onSelectDate = () => {},
  today = TODAY
}: HarnessProps) {
  const [visible, setVisible] = useState(start)
  return (
    <MiniMonthCalendar
      visible={visible}
      onVisibleChange={setVisible}
      today={today}
      from={from === null ? null : key(from)}
      to={to === null ? null : key(to)}
      onSelectDate={onSelectDate}
    />
  )
}

const day = (name: RegExp) => screen.getByRole('button', { name })

describe('MiniMonthCalendar', () => {
  it('lays out October 2026 Monday-first with Thursday the 1st', () => {
    render(<Harness />)
    expect(screen.getByTestId('mini-month-title')).toHaveTextContent(
      'October 2026'
    )
    const headers = screen
      .getAllByRole('columnheader')
      .map((header) => header.textContent)
    expect(headers).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    const first = day(/^Thursday, 1 October 2026/)
    const row = first.closest('[role="row"]') as HTMLElement
    // Three empty cells (Mon-Wed) precede the 1st.
    expect(row.children[3]).toContainElement(first)
  })

  it('disables every day after today and keeps today and earlier enabled', () => {
    render(<Harness />)
    expect(day(/^Sunday, 4 October 2026/)).toBeEnabled()
    expect(day(/^Monday, 5 October 2026/)).toBeDisabled()
    expect(day(/^Saturday, 31 October 2026/)).toBeDisabled()
    expect(day(/^Sunday, 4 October 2026/)).toHaveAttribute(
      'aria-current',
      'date'
    )
  })

  it('does not call back for a disabled day', () => {
    const onSelectDate = vi.fn()
    render(<Harness onSelectDate={onSelectDate} />)
    fireEvent.click(day(/^Monday, 5 October 2026/))
    expect(onSelectDate).not.toHaveBeenCalled()
    fireEvent.click(day(/^Friday, 2 October 2026/))
    expect(onSelectDate).toHaveBeenCalledWith('2026-10-02')
  })

  it('disables the next arrow when the next month is entirely in the future', () => {
    render(<Harness />)
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled()
  })

  it('enables the next arrow in an earlier month, and steps both ways', () => {
    render(<Harness start={{ year: 2026, month: 9 }} />)
    const next = screen.getByRole('button', { name: 'Next month' })
    expect(next).toBeEnabled()
    fireEvent.click(next)
    expect(screen.getByTestId('mini-month-title')).toHaveTextContent(
      'October 2026'
    )
    expect(next).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.getByTestId('mini-month-title')).toHaveTextContent(
      'August 2026'
    )
  })

  it('disables the next arrow when the next month starts after today (30 September)', () => {
    // Today is 30 September: October starts after it, so September's next is off.
    render(
      <Harness start={{ year: 2026, month: 9 }} today={key('2026-09-30')} />
    )
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled()
  })

  it('steps from December to January across the year', () => {
    render(<Harness start={{ year: 2025, month: 12 }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByTestId('mini-month-title')).toHaveTextContent(
      'January 2026'
    )
  })

  it('disables the previous arrow in January 1970', () => {
    render(<Harness start={{ year: 1970, month: 1 }} from={null} to={null} />)
    expect(
      screen.getByRole('button', { name: 'Previous month' })
    ).toBeDisabled()
  })

  it('marks the ends of the range and washes the days between', () => {
    render(
      <Harness
        start={{ year: 2026, month: 9 }}
        from="2026-09-10"
        to="2026-09-13"
      />
    )
    expect(day(/^Thursday, 10 September 2026, start date/)).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(day(/^Sunday, 13 September 2026, end date/)).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    const between = day(/^Friday, 11 September 2026/)
    expect(between).toHaveAttribute('aria-pressed', 'false')
    expect(between.parentElement).toHaveClass('bg-primary/10')
    expect(day(/^Monday, 14 September 2026/).parentElement).not.toHaveClass(
      'bg-primary/10'
    )
  })

  it('outlines rather than fills the ends when the range is inverted', () => {
    render(
      <Harness
        start={{ year: 2026, month: 9 }}
        from="2026-09-20"
        to="2026-09-12"
      />
    )
    const end = day(/^Saturday, 12 September 2026, end date/)
    expect(end).toHaveClass('ring-2')
    expect(end).not.toHaveClass('bg-primary')
    expect(day(/^Tuesday, 15 September 2026/).parentElement).not.toHaveClass(
      'bg-primary/10'
    )
  })

  describe('keyboard', () => {
    it('has a single tab stop, the range end', () => {
      render(<Harness />)
      const stops = screen
        .getAllByRole('button')
        .filter((button) => button.dataset.date && button.tabIndex === 0)
      expect(stops.map((button) => button.dataset.date)).toEqual(['2026-10-04'])
    })

    it('moves by day and week, clamped to today', () => {
      render(<Harness />)
      const start = day(/^Sunday, 4 October 2026/)
      start.focus()
      fireEvent.keyDown(start, { key: 'ArrowLeft' })
      expect(day(/^Saturday, 3 October 2026/)).toHaveFocus()
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' })
      expect(day(/^Saturday, 26 September 2026/)).toHaveFocus()
      // Leaving the month turns the page and keeps focus on the new day.
      expect(screen.getByTestId('mini-month-title')).toHaveTextContent(
        'September 2026'
      )
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' })
      expect(day(/^Saturday, 3 October 2026/)).toHaveFocus()
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' })
      // 10 October is after today: focus clamps to today.
      expect(day(/^Sunday, 4 October 2026/)).toHaveFocus()
    })

    it('Home and End go to the ends of the week, Page keys by month', () => {
      render(<Harness />)
      const start = day(/^Friday, 2 October 2026/)
      start.focus()
      fireEvent.keyDown(start, { key: 'Home' })
      expect(day(/^Monday, 28 September 2026/)).toHaveFocus()
      fireEvent.keyDown(document.activeElement as Element, { key: 'End' })
      expect(day(/^Sunday, 4 October 2026/)).toHaveFocus()
      fireEvent.keyDown(document.activeElement as Element, { key: 'PageUp' })
      expect(day(/^Friday, 4 September 2026/)).toHaveFocus()
    })

    it('ignores other keys', () => {
      render(<Harness />)
      const start = day(/^Sunday, 4 October 2026/)
      start.focus()
      const proceeded = fireEvent.keyDown(start, { key: 'a' })
      expect(proceeded).toBe(true)
      expect(start).toHaveFocus()
    })
  })
})
