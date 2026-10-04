import {
  ANNUAL_CELL_MAX,
  ANNUAL_CELL_MIN,
  annualCellSize,
  annualGridScrolls,
  annualYearGrid,
  annualYearGrids,
  monthCellSize,
  monthGrid,
  monthNeedsListAlternative
} from './geometry'
import { DateKey, addDays, parseDateKey, weekdayMon0 } from './localDay'

const key = (value: string): DateKey => {
  const parsed = parseDateKey(value)
  if (!parsed) throw new Error(`Test fixture is not a date key: ${value}`)
  return parsed
}

const TODAY = key('2026-10-04')

const yearRange = (year: number) => ({
  from: key(`${year}-01-01`),
  to: key(`${year}-12-31`)
})

const cellOf = (
  grid: ReturnType<typeof annualYearGrid>,
  date: string
): ReturnType<typeof annualYearGrid>['cells'][number] => {
  const cell = grid.cells.find((candidate) => candidate.date === date)
  if (!cell) throw new Error(`No cell for ${date}`)
  return cell
}

describe('annualYearGrid', () => {
  describe('2026 year to date on 2026-10-04', () => {
    const grid = annualYearGrid({
      year: 2026,
      range: { from: key('2026-01-01'), to: TODAY },
      today: TODAY
    })

    it('has 40 columns ending on Sunday 4 October, with no upcoming area', () => {
      expect(grid.weeks).toBe(40)
      expect(grid.firstDate).toBe('2026-01-01')
      expect(grid.lastDate).toBe('2026-10-04')
      const last = grid.cells[grid.cells.length - 1]
      expect(last).toMatchObject({
        date: '2026-10-04',
        col: 39,
        row: 6,
        state: 'today',
        isToday: true
      })
      expect(weekdayMon0(TODAY)).toBe(6)
      expect(grid.cells.every((cell) => cell.date <= TODAY)).toBe(true)
      expect(grid.cells.some((cell) => cell.col >= 40)).toBe(false)
    })

    it('holds exactly the days from 1 Jan to today', () => {
      // 1 Jan is the 1st and 4 Oct the 277th day of 2026.
      expect(grid.cells).toHaveLength(277)
      expect(grid.cells[0].date).toBe('2026-01-01')
    })

    it('starts on the Monday on or before 1 Jan and marks the padding before it', () => {
      // 1 Jan 2026 is a Thursday, so Mon-Wed of column 0 are padding.
      expect(cellOf(grid, '2026-01-01')).toMatchObject({ col: 0, row: 3 })
      expect(grid.leadingPadding).toBe(3)
      expect(grid.trailingPadding).toBe(0)
      expect(grid.padding).toEqual([
        { col: 0, row: 0, position: 'leading' },
        { col: 0, row: 1, position: 'leading' },
        { col: 0, row: 2, position: 'leading' }
      ])
    })

    it('treats every day as in range and only today as today', () => {
      expect(grid.cells.filter((cell) => cell.state === 'today')).toHaveLength(
        1
      )
      expect(grid.cells.filter((cell) => cell.state === 'out')).toHaveLength(0)
    })

    it('puts each month label in the column of the week containing the 1st', () => {
      expect(grid.monthLabels.map((label) => label.month)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10
      ])
      for (const label of grid.monthLabels) {
        const first = cellOf(
          grid,
          `2026-${String(label.month).padStart(2, '0')}-01`
        )
        expect(label.col).toBe(first.col)
      }
      expect(grid.monthLabels[0].col).toBe(0)
      // 1 Oct 2026 is a Thursday in the last column.
      expect(grid.monthLabels[9]).toMatchObject({ month: 10, col: 39 })
    })

    it('exposes the month-start columns as snap anchors', () => {
      expect(grid.monthStartColumns).toEqual(
        grid.monthLabels.map((label) => label.col)
      )
      expect(grid.monthStartColumns).toEqual([
        0, 4, 8, 13, 17, 22, 26, 30, 35, 39
      ])
    })

    it('right-aligns a trailing label that would overrun the grid', () => {
      expect(grid.monthLabels[9]).toMatchObject({ span: 1, alignEnd: true })
      expect(grid.monthLabels[8]).toMatchObject({ span: 3, alignEnd: false })
    })
  })

  describe('2024 (leap year, Monday start)', () => {
    const grid = annualYearGrid({
      year: 2024,
      range: yearRange(2024),
      today: TODAY
    })

    it('has 53 columns and no leading padding', () => {
      expect(grid.weeks).toBe(53)
      expect(grid.leadingPadding).toBe(0)
      expect(cellOf(grid, '2024-01-01')).toMatchObject({ col: 0, row: 0 })
    })

    it('contains 29 February and 366 days', () => {
      expect(grid.cells).toHaveLength(366)
      expect(cellOf(grid, '2024-02-29')).toMatchObject({ row: 3, state: 'in' })
      expect(grid.lastDate).toBe('2024-12-31')
    })

    it('pads the rest of the last column after Tuesday 31 Dec', () => {
      expect(cellOf(grid, '2024-12-31')).toMatchObject({ col: 52, row: 1 })
      expect(grid.trailingPadding).toBe(5)
      expect(grid.padding.every((slot) => slot.position === 'trailing')).toBe(
        true
      )
      expect(grid.padding.map((slot) => [slot.col, slot.row])).toEqual([
        [52, 2],
        [52, 3],
        [52, 4],
        [52, 5],
        [52, 6]
      ])
    })
  })

  describe('2025 (Wednesday start)', () => {
    const grid = annualYearGrid({
      year: 2025,
      range: yearRange(2025),
      today: TODAY
    })

    it('has 53 columns, 365 days and two leading padding slots', () => {
      expect(grid.weeks).toBe(53)
      expect(grid.cells).toHaveLength(365)
      expect(cellOf(grid, '2025-01-01')).toMatchObject({ col: 0, row: 2 })
      expect(grid.leadingPadding).toBe(2)
      expect(grid.padding.slice(0, 2)).toEqual([
        { col: 0, row: 0, position: 'leading' },
        { col: 0, row: 1, position: 'leading' }
      ])
    })

    it('ends on Wednesday 31 Dec in the last column', () => {
      expect(cellOf(grid, '2025-12-31')).toMatchObject({ col: 52, row: 2 })
    })
  })

  describe('invariants', () => {
    const years = [2023, 2024, 2025, 2026]

    it.each(years)(
      'places every day of %i in a distinct slot of the right weekday row',
      (year) => {
        const grid = annualYearGrid({
          year,
          range: yearRange(year),
          today: TODAY
        })
        const slots = new Set<string>()
        for (const cell of grid.cells) {
          expect(cell.row).toBe(weekdayMon0(cell.date))
          expect(cell.col).toBeGreaterThanOrEqual(0)
          expect(cell.col).toBeLessThan(grid.weeks)
          slots.add(`${cell.col}:${cell.row}`)
        }
        for (const slot of grid.padding) slots.add(`${slot.col}:${slot.row}`)
        // Days and padding together fill the grid exactly: nothing overlaps
        // and nothing is left over.
        expect(slots.size).toBe(grid.cells.length + grid.padding.length)
        expect(slots.size).toBe(grid.weeks * 7)
      }
    )

    it.each(years)(
      'steps one column every Monday in %i, so columns are consecutive weeks',
      (year) => {
        const grid = annualYearGrid({
          year,
          range: yearRange(year),
          today: TODAY
        })
        for (let index = 1; index < grid.cells.length; index += 1) {
          const previous = grid.cells[index - 1]
          const cell = grid.cells[index]
          expect(cell.col - previous.col).toBe(cell.row === 0 ? 1 : 0)
        }
      }
    )

    it.each(years)(
      'never lays two month labels on top of each other in %i',
      (year) => {
        const grid = annualYearGrid({
          year,
          range: yearRange(year),
          today: TODAY
        })
        // 2026 is year to date on 2026-10-04, so it stops at October.
        expect(grid.monthLabels).toHaveLength(year === 2026 ? 10 : 12)
        // A label at its own column is never inside the previous label's span,
        // which is the label-overlap guarantee the old heatmap test covered.
        for (let index = 1; index < grid.monthLabels.length; index += 1) {
          const previous = grid.monthLabels[index - 1]
          expect(grid.monthLabels[index].col).toBeGreaterThanOrEqual(
            previous.col + previous.span
          )
        }
        for (const label of grid.monthLabels) {
          expect(label.col + label.span).toBeLessThanOrEqual(grid.weeks)
        }
      }
    )
  })

  describe('range handling', () => {
    it('marks days outside the range as out, distinct from padding and rest days', () => {
      const grid = annualYearGrid({
        year: 2025,
        range: { from: key('2025-10-05'), to: key('2026-10-04') },
        today: TODAY
      })
      expect(grid.weeks).toBe(53)
      expect(cellOf(grid, '2025-10-04').state).toBe('out')
      expect(cellOf(grid, '2025-10-05').state).toBe('in')
      expect(cellOf(grid, '2025-12-31').state).toBe('in')
      expect(cellOf(grid, '2025-01-01').state).toBe('out')
      const states = new Set(grid.cells.map((cell) => cell.state))
      expect(states).toEqual(new Set(['in', 'out']))
      // Padding slots are not cells at all.
      expect(grid.cells).toHaveLength(365)
    })

    it('still ends the current year at today when the range ends earlier', () => {
      const grid = annualYearGrid({
        year: 2026,
        range: { from: key('2026-03-01'), to: key('2026-06-30') },
        today: TODAY
      })
      expect(grid.lastDate).toBe('2026-10-04')
      expect(cellOf(grid, '2026-02-28').state).toBe('out')
      expect(cellOf(grid, '2026-03-01').state).toBe('in')
      expect(cellOf(grid, '2026-06-30').state).toBe('in')
      expect(cellOf(grid, '2026-07-01').state).toBe('out')
      expect(cellOf(grid, '2026-10-04')).toMatchObject({
        state: 'out',
        isToday: true
      })
    })

    it('flags which month labels have days in the range', () => {
      const grid = annualYearGrid({
        year: 2025,
        range: { from: key('2025-10-05'), to: key('2026-10-04') },
        today: TODAY
      })
      const inRange = grid.monthLabels
        .filter((label) => label.inRange)
        .map((label) => label.month)
      // October holds the range's first day, so it counts.
      expect(inRange).toEqual([10, 11, 12])
    })

    it('returns an empty grid for a year that has not started', () => {
      const grid = annualYearGrid({
        year: 2027,
        range: yearRange(2027),
        today: TODAY
      })
      expect(grid).toMatchObject({
        weeks: 0,
        cells: [],
        padding: [],
        monthLabels: [],
        monthStartColumns: []
      })
    })

    it('ends on 1 Jan itself when today is 1 Jan', () => {
      const newYear = key('2026-01-01')
      const grid = annualYearGrid({
        year: 2026,
        range: { from: newYear, to: newYear },
        today: newYear
      })
      expect(grid.weeks).toBe(1)
      expect(grid.cells).toHaveLength(1)
      expect(grid.cells[0]).toMatchObject({ col: 0, row: 3, state: 'today' })
      expect(grid.trailingPadding).toBe(3)
    })
  })
})

describe('annualYearGrids', () => {
  it('gives one grid per calendar year, oldest first', () => {
    const grids = annualYearGrids({
      range: { from: key('2024-06-01'), to: TODAY },
      today: TODAY
    })
    expect(grids.map((grid) => grid.year)).toEqual([2024, 2025, 2026])
    expect(grids.map((grid) => grid.weeks)).toEqual([53, 53, 40])
  })

  it('marks cells outside the range in every row of a multi-year range', () => {
    const grids = annualYearGrids({
      range: { from: key('2025-10-05'), to: TODAY },
      today: TODAY
    })
    expect(grids.map((grid) => grid.year)).toEqual([2025, 2026])
    expect(cellOf(grids[0], '2025-10-04').state).toBe('out')
    expect(cellOf(grids[0], '2025-10-05').state).toBe('in')
    expect(cellOf(grids[1], '2026-01-01').state).toBe('in')
    expect(grids[1].lastDate).toBe('2026-10-04')
  })

  it('is one row for a range inside a single year', () => {
    expect(
      annualYearGrids({ range: yearRange(2025), today: TODAY })
    ).toHaveLength(1)
  })

  it('leaves out years after today', () => {
    const grids = annualYearGrids({
      range: { from: key('2026-01-01'), to: key('2027-12-31') },
      today: TODAY
    })
    expect(grids.map((grid) => grid.year)).toEqual([2026])
  })
})

describe('monthGrid', () => {
  it('has one leading slot for September 2026, which starts on a Tuesday', () => {
    const grid = monthGrid({ year: 2026, month: 9, today: TODAY })
    expect(grid.leading).toBe(1)
    expect(grid.days).toHaveLength(30)
    expect(grid.days[0]).toMatchObject({ date: '2026-09-01', col: 1, row: 0 })
    expect(grid.weeks).toBe(5)
    expect(grid.trailing).toBe(4)
    expect(grid.weekdays.map((day) => day.short)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun'
    ])
  })

  it('has 28 cells and no padding for February 2026, which starts on a Sunday', () => {
    const grid = monthGrid({ year: 2026, month: 2, today: TODAY })
    expect(grid.days).toHaveLength(28)
    // 1 Feb 2026 is a Sunday: six leading slots.
    expect(grid.leading).toBe(6)
    expect(grid.days[0]).toMatchObject({ col: 6, row: 0 })
    expect(grid.days[27]).toMatchObject({ date: '2026-02-28', col: 5, row: 4 })
    expect(grid.weeks).toBe(5)
  })

  it('has 29 cells in February of a leap year', () => {
    const grid = monthGrid({ year: 2024, month: 2, today: TODAY })
    expect(grid.days).toHaveLength(29)
    expect(grid.days[28].date).toBe('2024-02-29')
  })

  it('fits February 2027 in four exact weeks', () => {
    // 1 Feb 2027 is a Monday and the month has 28 days.
    const grid = monthGrid({ year: 2027, month: 2, today: TODAY })
    expect(grid.leading).toBe(0)
    expect(grid.trailing).toBe(0)
    expect(grid.weeks).toBe(4)
  })

  it('lays every day in its weekday column', () => {
    const grid = monthGrid({ year: 2026, month: 10, today: TODAY })
    for (const day of grid.days) {
      expect(day.col).toBe(weekdayMon0(day.date))
      expect(day.day).toBe(Number(day.date.slice(8)))
    }
    expect(grid.leading + grid.days.length + grid.trailing).toBe(grid.weeks * 7)
  })

  describe('in the current month', () => {
    const grid = monthGrid({ year: 2026, month: 10, today: TODAY })

    it('flags today and outlines the days after it as upcoming', () => {
      expect(grid.isCurrentMonth).toBe(true)
      const byState = (state: string) =>
        grid.days.filter((day) => day.state === state).map((day) => day.day)
      expect(byState('past')).toEqual([1, 2, 3])
      expect(byState('today')).toEqual([4])
      expect(byState('upcoming')).toHaveLength(27)
      expect(grid.days.find((day) => day.isToday)?.date).toBe('2026-10-04')
      expect(grid.days.filter((day) => day.isToday)).toHaveLength(1)
    })
  })

  it('has no upcoming or today day in a past month', () => {
    const grid = monthGrid({ year: 2026, month: 9, today: TODAY })
    expect(grid.isCurrentMonth).toBe(false)
    expect(grid.days.every((day) => day.state === 'past')).toBe(true)
    expect(grid.days.some((day) => day.isToday)).toBe(false)
  })

  it('has only upcoming days in a future month', () => {
    const grid = monthGrid({ year: 2026, month: 11, today: TODAY })
    expect(grid.isCurrentMonth).toBe(false)
    expect(grid.days.every((day) => day.state === 'upcoming')).toBe(true)
  })

  it('marks the last day of the month today on the 31st', () => {
    const grid = monthGrid({ year: 2026, month: 10, today: key('2026-10-31') })
    expect(grid.days.every((day) => day.state !== 'upcoming')).toBe(true)
    expect(grid.days[30]).toMatchObject({ state: 'today', isToday: true })
  })

  it('rejects a month that does not exist', () => {
    expect(() => monthGrid({ year: 2026, month: 13, today: TODAY })).toThrow(
      RangeError
    )
    expect(() => monthGrid({ year: 2026, month: 0, today: TODAY })).toThrow(
      RangeError
    )
  })

  it('does not depend on the day after today existing', () => {
    // addDays is plain calendar arithmetic, so the day after the last day of
    // a month crosses into the next one without a zone anywhere.
    expect(addDays(key('2026-10-31'), 1)).toBe('2026-11-01')
  })
})

describe('annualCellSize', () => {
  it('is clamp(12, (avail - 28 - N*3) / N, 18)', () => {
    // 40 columns in 908px: (908 - 28 - 120) / 40 = 19, clamped to 18.
    expect(annualCellSize(908, 40)).toBe(ANNUAL_CELL_MAX)
    // 40 columns in 730px: (730 - 28 - 120) / 40 = 14.55.
    expect(annualCellSize(730, 40)).toBeCloseTo(14.55, 5)
    // 53 columns in 908px: (908 - 28 - 159) / 53 = 13.6.
    expect(annualCellSize(908, 53)).toBeCloseTo(13.604, 3)
  })

  it('keeps 12px below the minimum', () => {
    expect(annualCellSize(390, 53)).toBe(ANNUAL_CELL_MIN)
    expect(annualCellSize(320, 40)).toBe(ANNUAL_CELL_MIN)
    expect(annualCellSize(0, 40)).toBe(ANNUAL_CELL_MIN)
    expect(annualCellSize(-50, 40)).toBe(ANNUAL_CELL_MIN)
  })

  it('stays within bounds for a degenerate input', () => {
    expect(annualCellSize(908, 0)).toBe(ANNUAL_CELL_MIN)
    expect(annualCellSize(Number.NaN, 40)).toBe(ANNUAL_CELL_MIN)
    expect(annualCellSize(10000, 1)).toBe(ANNUAL_CELL_MAX)
  })

  it('reports when the grid must scroll inside its container', () => {
    expect(annualGridScrolls(390, 40)).toBe(true)
    expect(annualGridScrolls(908, 53)).toBe(false)
    // (avail - 28 - 3N) / N is exactly 12 at avail = 28 + 15N.
    expect(annualGridScrolls(28 + 15 * 40, 40)).toBe(false)
    expect(annualGridScrolls(28 + 15 * 40 - 1, 40)).toBe(true)
    expect(annualGridScrolls(500, 0)).toBe(false)
  })
})

describe('monthCellSize', () => {
  it('is min(92, (avail - 24) / 7)', () => {
    expect(monthCellSize(908)).toBe(92)
    expect(monthCellSize(730)).toBe(92)
    expect(monthCellSize(390)).toBeCloseTo(52.29, 2)
    expect(monthCellSize(320)).toBeCloseTo(42.29, 2)
  })

  it('reaches 92px at 668px and never exceeds it', () => {
    expect(monthCellSize(7 * 92 + 24)).toBe(92)
    expect(monthCellSize(5000)).toBe(92)
  })

  it('never goes below zero', () => {
    expect(monthCellSize(10)).toBe(0)
    expect(monthCellSize(Number.NaN)).toBe(0)
  })
})

describe('monthNeedsListAlternative', () => {
  it('is true below 7x44 + 6x4 = 332px', () => {
    expect(monthNeedsListAlternative(320)).toBe(true)
    expect(monthNeedsListAlternative(331.9)).toBe(true)
  })

  it('is false from 332px, where cells are exactly 44px', () => {
    expect(monthNeedsListAlternative(332)).toBe(false)
    expect(monthCellSize(332)).toBe(44)
    expect(monthNeedsListAlternative(390)).toBe(false)
    expect(monthNeedsListAlternative(908)).toBe(false)
  })
})
