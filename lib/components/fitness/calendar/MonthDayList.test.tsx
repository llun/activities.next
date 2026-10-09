/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import type { FitnessCalendarDay } from '@/lib/fitness/calendar/types'

import { MonthDayList } from './MonthDayList'
import { TODAY, key } from './calendarTestDoubles'

const day = (
  date: string,
  count: number,
  km = 10,
  minutes = 30
): FitnessCalendarDay => ({
  date,
  count,
  totalDistanceMeters: km * 1000,
  totalDurationSeconds: minutes * 60,
  totalElevationGainMeters: 0
})

const DAYS = [day('2026-10-02', 4, 120, 200), day('2026-10-01', 1, 5, 20)]

type Props = Partial<Parameters<typeof MonthDayList>[0]>

const renderList = (props: Props = {}) => {
  const onSelectDate = vi.fn()
  const view = render(
    <MonthDayList
      year={2026}
      month={10}
      today={TODAY}
      days={DAYS}
      metric="count"
      selectedDate={null}
      onSelectDate={onSelectDate}
      {...props}
    />
  )
  return { ...view, onSelectDate }
}

const rowButtons = () => screen.getAllByRole('button')

describe('MonthDayList', () => {
  it('lists each day up to today, with count, distance and duration', () => {
    renderList()

    expect(rowButtons()).toHaveLength(4)
    expect(screen.getByRole('button', { name: /Fri 2 Oct/ })).toHaveTextContent(
      '4 activities · 120 km · 3h 20m'
    )
    expect(screen.getByRole('button', { name: /Thu 1 Oct/ })).toHaveTextContent(
      '1 activity · 5.0 km · 20m'
    )
    expect(screen.getByRole('button', { name: /Sat 3 Oct/ })).toHaveTextContent(
      'No activities'
    )
  })

  it('selects a day on click and marks it with aria-pressed', () => {
    const { onSelectDate, rerender } = renderList()

    fireEvent.click(screen.getByRole('button', { name: /Fri 2 Oct/ }))
    expect(onSelectDate).toHaveBeenCalledWith('2026-10-02')

    rerender(
      <MonthDayList
        year={2026}
        month={10}
        today={TODAY}
        days={DAYS}
        metric="count"
        selectedDate={key('2026-10-02')}
        onSelectDate={onSelectDate}
      />
    )
    expect(screen.getByRole('button', { name: /Fri 2 Oct/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: /Thu 1 Oct/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  it('says Today in words and in aria-current', () => {
    renderList()

    const today = screen.getByRole('button', { name: /Sun 4 Oct/ })
    expect(today).toHaveAttribute('aria-current', 'date')
    expect(today).toHaveTextContent('Today')
  })

  it('collapses the upcoming days into one non-interactive summary row', () => {
    const { container } = renderList()

    const summary = container.querySelector('[data-slot="upcoming-summary"]')
    expect(summary).toHaveTextContent('Upcoming: Mon 5 Oct – Sat 31 Oct')
    expect(summary?.querySelector('button')).toBeNull()
    expect(screen.queryByRole('button', { name: /Mon 5 Oct/ })).toBeNull()
  })

  it('has no summary row once the month is over', () => {
    const { container } = renderList({ month: 9 })

    expect(rowButtons()).toHaveLength(30)
    expect(container.querySelector('[data-slot="upcoming-summary"]')).toBeNull()
  })

  it('leaves out days the applied range does not cover', () => {
    renderList({
      month: 9,
      range: { from: key('2026-09-28'), to: TODAY }
    })

    expect(rowButtons().map((row) => row.textContent)).toEqual([
      expect.stringContaining('Mon 28 Sep'),
      expect.stringContaining('Tue 29 Sep'),
      expect.stringContaining('Wed 30 Sep')
    ])
  })

  it('lists the last day of the applied range', () => {
    const current = renderList({
      range: { from: key('2026-10-01'), to: TODAY }
    })
    expect(rowButtons().map((row) => row.textContent)).toContainEqual(
      expect.stringContaining('Sun 4 Oct')
    )
    current.unmount()

    renderList({
      month: 9,
      range: { from: key('2026-09-01'), to: key('2026-09-30') }
    })
    expect(rowButtons()).toHaveLength(30)
  })

  it('names the list by month', () => {
    renderList()

    expect(
      screen.getByRole('list', { name: 'October 2026, day by day' })
    ).toBeInTheDocument()
  })

  it('keeps the rows while loading: busy, with static swatches', () => {
    const { container } = renderList({ loading: true })

    expect(rowButtons()).toHaveLength(4)
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(container.innerHTML).not.toMatch(/animate-|shimmer/)
  })

  it('says "Loading" under each date, never "No activities", before the data lands', () => {
    const { container } = renderList({ loading: true, days: [] })

    expect(rowButtons()).toHaveLength(4)
    expect(container).not.toHaveTextContent('No activities')
    expect(screen.getByRole('button', { name: /Fri 2 Oct/ })).toHaveTextContent(
      'Loading'
    )
  })

  it('shades each swatch by the metric', () => {
    const { container } = renderList({ metric: 'distance' })

    // 120 km is the top band; 5 km the bottom one; rest days are 0.
    const levels = [...container.querySelectorAll('button [data-level]')].map(
      (swatch) => swatch.getAttribute('data-level')
    )
    expect(levels).toEqual(['1', '4', '0', '0'])
  })
})
