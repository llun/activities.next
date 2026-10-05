/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { annualYearGrid } from '@/lib/fitness/calendar/geometry'

import { AnnualYearRow, AnnualYearRowProps } from './AnnualYearRow'
import { indexDays } from './calendarShared'
import { TODAY, key } from './calendarTestDoubles'

const grid2026 = annualYearGrid({
  year: 2026,
  range: { from: key('2026-01-01'), to: TODAY },
  today: TODAY
})

const renderRow = (props: Partial<AnnualYearRowProps> = {}) => {
  const onOpenMonth = vi.fn()
  const onScroll = vi.fn()
  const view = render(
    <AnnualYearRow
      grid={grid2026}
      caption="Activity through 4 Oct"
      dayIndex={indexDays([])}
      metric="count"
      selectedDate={null}
      tabStopDate={key('2026-10-04')}
      loading={false}
      layoutKey="18px"
      helpId="help"
      onOpenMonth={onOpenMonth}
      onScroll={onScroll}
      {...props}
    />
  )
  return { ...view, onOpenMonth, onScroll }
}

describe('AnnualYearRow', () => {
  it('is a labelled group for its year', () => {
    renderRow()

    expect(
      screen.getByRole('group', { name: 'Training calendar, 2026' })
    ).toHaveAttribute('aria-describedby', 'help')
  })

  it('shows the year, then what the row covers, under the grid', () => {
    renderRow()

    expect(screen.getByText(/Activity through 4 Oct/).textContent).toBe(
      '2026 · Activity through 4 Oct'
    )
  })

  it('renders the trailing node (the legend) beside the caption', () => {
    renderRow({ trailing: <ul aria-label="Legend" /> })

    expect(screen.getByLabelText('Legend')).toBeInTheDocument()
  })

  it('gives only the tab-stop day a tab stop', () => {
    const { container } = renderRow({ tabStopDate: key('2026-05-05') })

    const stops = container.querySelectorAll('[data-date][tabindex="0"]')
    expect([...stops].map((stop) => stop.getAttribute('data-date'))).toEqual([
      '2026-05-05'
    ])
  })

  it('has one cell per day and one snap anchor per month start', () => {
    const { container } = renderRow()

    expect(container.querySelectorAll('[data-date]')).toHaveLength(277)
    expect(container.querySelectorAll('[data-snap-anchor]')).toHaveLength(10)
  })

  it('opens a month from its label', () => {
    const { onOpenMonth } = renderRow()

    fireEvent.click(screen.getByRole('button', { name: 'Show March 2026' }))

    expect(onOpenMonth).toHaveBeenCalledWith(2026, 3)
  })

  it('tells its owner when the scroller moves, so a hover tooltip can hide', () => {
    const { container, onScroll } = renderRow()

    fireEvent.scroll(
      container.querySelector('[data-slot="annual-scroller"]') as Element
    )

    expect(onScroll).toHaveBeenCalledTimes(1)
  })

  it('marks every cell loading while it loads', () => {
    const { container } = renderRow({ loading: true })

    expect(
      [...container.querySelectorAll('[data-date]')].every(
        (cell) => cell.getAttribute('data-loading') === 'true'
      )
    ).toBe(true)
  })

  it('draws a quiet label for a month the range does not reach', () => {
    const grid = annualYearGrid({
      year: 2026,
      range: { from: key('2026-04-01'), to: TODAY },
      today: TODAY
    })
    renderRow({ grid })

    expect(
      screen.queryByRole('button', { name: 'Show February 2026' })
    ).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Show April 2026' })
    ).toBeInTheDocument()
  })
})
