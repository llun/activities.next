/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { HeatCell, HeatCellProps } from './HeatCell'
import { key } from './calendarTestDoubles'

const renderCell = (props: Partial<HeatCellProps> = {}) =>
  render(
    <HeatCell
      date={key('2026-10-02')}
      variant="annual"
      kind="active"
      level={2}
      isToday={false}
      selected={false}
      tabStop={false}
      loading={false}
      label="Friday, 2 October 2026: 2 activities"
      column={5}
      row={6}
      {...props}
    />
  )

const cell = () => screen.getByRole('button')

describe('HeatCell', () => {
  it('is a button named by its label, placed on its column and row', () => {
    renderCell()

    expect(cell()).toHaveAccessibleName('Friday, 2 October 2026: 2 activities')
    expect(cell()).toHaveAttribute('data-date', '2026-10-02')
    expect(cell().style.gridColumn).toBe('5')
    expect(cell().style.gridRow).toBe('6')
  })

  it('carries its heat level for the stylesheet', () => {
    renderCell({ level: 3 })

    expect(cell()).toHaveAttribute('data-level', '3')
    expect(cell()).toHaveAttribute('data-state', 'active')
  })

  it.each(['upcoming', 'out'] as const)(
    'is a disabled, level-less %s cell with no tab stop',
    (kind) => {
      renderCell({ kind, tabStop: true, selected: true })

      expect(cell()).toBeDisabled()
      expect(cell()).toHaveAttribute('data-state', kind)
      expect(cell()).not.toHaveAttribute('data-level')
      expect(cell()).not.toHaveAttribute('aria-pressed')
      expect(cell()).toHaveAttribute('tabindex', '-1')
    }
  )

  it('is the tab stop only when it says so', () => {
    const { rerender } = renderCell({ tabStop: true })
    expect(cell()).toHaveAttribute('tabindex', '0')

    rerender(
      <HeatCell
        date={key('2026-10-02')}
        variant="annual"
        kind="active"
        level={2}
        isToday={false}
        selected={false}
        tabStop={false}
        loading={false}
        label="x"
        column={5}
        row={6}
      />
    )
    expect(cell()).toHaveAttribute('tabindex', '-1')
  })

  it('reports selection with aria-pressed and today with aria-current', () => {
    renderCell({ selected: true, isToday: true })

    expect(cell()).toHaveAttribute('aria-pressed', 'true')
    expect(cell()).toHaveAttribute('aria-current', 'date')
  })

  it('draws a dot for today in an annual cell, and a numeral in a month cell', () => {
    const { rerender } = renderCell({ isToday: true })
    expect(cell().querySelector('span[aria-hidden="true"]')).not.toBeNull()
    expect(cell()).toHaveTextContent('')

    rerender(
      <HeatCell
        date={key('2026-10-02')}
        variant="month"
        kind="active"
        level={2}
        numeral={2}
        isToday
        selected={false}
        tabStop={false}
        loading={false}
        label="x"
        column={5}
        row={6}
      />
    )
    expect(cell()).toHaveTextContent('2')
    expect(cell().querySelector('span[aria-hidden="true"]')).toBeNull()
  })

  it('flags loading without changing its level', () => {
    renderCell({ loading: true, level: 4 })

    expect(cell()).toHaveAttribute('data-loading', 'true')
    expect(cell()).toHaveAttribute('data-level', '4')
  })
})
