import { withTimeZone } from '@/lib/testing/withTimeZone'

import {
  formatDistance,
  formatDuration,
  formatFullDate,
  formatLocalTime,
  formatRange,
  formatWeekdayDayMonth
} from './format'
import { annualYearGrid, monthGrid } from './geometry'
import { DateKey, parseDateKey } from './localDay'

// The only calendar-formatting test that moves the process zone. It is a file
// of its own because `withTimeZone` routes its importer to the forked-process
// project. Date keys, the year grid and the month grid are calendar math and
// must read the same whatever the machine's `TZ` is.

const key = (value: string): DateKey => {
  const parsed = parseDateKey(value)
  if (!parsed) throw new Error(`Test fixture is not a date key: ${value}`)
  return parsed
}

const TODAY = key('2026-10-04')

const evaluate = () => ({
  full: formatFullDate(key('2026-09-24')),
  fullLeap: formatFullDate(key('2024-02-29')),
  row: formatWeekdayDayMonth(key('2026-03-29')),
  range: formatRange(key('2025-10-05'), TODAY),
  distance: formatDistance(1_024_300),
  duration: formatDuration(1024 * 3600 + 300),
  localTime: formatLocalTime(Date.UTC(2026, 9, 4, 23, 30), 'Europe/Amsterdam'),
  annual: (() => {
    const grid = annualYearGrid({
      year: 2026,
      range: { from: key('2026-01-01'), to: TODAY },
      today: TODAY
    })
    return { weeks: grid.weeks, cells: grid.cells, labels: grid.monthLabels }
  })(),
  month: monthGrid({ year: 2026, month: 3, today: key('2026-03-29') })
})

describe('calendar formatting and geometry ignore the process time zone', () => {
  it.each(['Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati'])(
    'returns the UTC-process results when the process is in %s',
    async (zone) => {
      const baseline = evaluate()
      const moved = await withTimeZone(zone, () => {
        expect(new Date(2026, 5, 15).getTimezoneOffset()).not.toBe(0)
        return evaluate()
      })
      expect(moved).toEqual(baseline)
    }
  )

  it('keeps the dates right in a zone west of UTC', async () => {
    await withTimeZone('America/Los_Angeles', () => {
      expect(formatFullDate(key('2026-09-24'))).toBe(
        'Thursday, 24 September 2026'
      )
      expect(formatRange(key('2026-01-01'), key('2026-10-04'))).toBe(
        '1 Jan – 4 Oct 2026'
      )
    })
  })
})
