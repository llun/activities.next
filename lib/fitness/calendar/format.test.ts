import {
  formatActivityCount,
  formatDateRange,
  formatDistance,
  formatDuration,
  formatElevation,
  formatFullDate,
  formatLocalTime,
  formatMonthLong,
  formatMonthShort,
  formatMonthYear,
  formatRange,
  formatShortDate,
  formatWeekdayDayMonth
} from './format'
import { DateKey, parseDateKey } from './localDay'

const key = (value: string): DateKey => {
  const parsed = parseDateKey(value)
  if (!parsed) throw new Error(`Test fixture is not a date key: ${value}`)
  return parsed
}

const NBSP = ' '

describe('formatRange', () => {
  it('gives the year once for a range inside one year', () => {
    expect(formatRange(key('2026-01-01'), key('2026-10-04'))).toBe(
      '1 Jan – 4 Oct 2026'
    )
  })

  it('gives both years for a range that crosses a year boundary', () => {
    expect(formatRange(key('2025-10-05'), key('2026-10-04'))).toBe(
      '5 Oct 2025 – 4 Oct 2026'
    )
    expect(formatRange(key('2025-12-31'), key('2026-01-01'))).toBe(
      '31 Dec 2025 – 1 Jan 2026'
    )
  })

  it('gives the month once for a range inside one month', () => {
    expect(formatRange(key('2026-10-01'), key('2026-10-04'))).toBe(
      '1 – 4 Oct 2026'
    )
    expect(formatRange(key('2026-09-01'), key('2026-09-30'))).toBe(
      '1 – 30 Sep 2026'
    )
    expect(formatRange(key('2024-02-01'), key('2024-02-29'))).toBe(
      '1 – 29 Feb 2024'
    )
    // The same month number in another year is not the same month.
    expect(formatRange(key('2025-10-05'), key('2026-10-04'))).toBe(
      '5 Oct 2025 – 4 Oct 2026'
    )
    // Adjacent months keep both names.
    expect(formatRange(key('2026-09-30'), key('2026-10-01'))).toBe(
      '30 Sep – 1 Oct 2026'
    )
  })

  it('collapses a single day', () => {
    expect(formatRange(key('2026-10-04'), key('2026-10-04'))).toBe('4 Oct 2026')
  })

  it('formats a full past year and a leap day', () => {
    expect(formatRange(key('2024-01-01'), key('2024-12-31'))).toBe(
      '1 Jan – 31 Dec 2024'
    )
    expect(formatRange(key('2024-02-29'), key('2024-03-01'))).toBe(
      '29 Feb – 1 Mar 2024'
    )
  })

  it('is also exported under the architecture name', () => {
    expect(formatDateRange).toBe(formatRange)
  })
})

describe('date text', () => {
  it('formats a full date', () => {
    expect(formatFullDate(key('2026-09-24'))).toBe(
      'Thursday, 24 September 2026'
    )
    expect(formatFullDate(key('2024-02-29'))).toBe('Thursday, 29 February 2024')
    expect(formatFullDate(key('2026-10-04'))).toBe('Sunday, 4 October 2026')
    expect(formatFullDate(key('2026-03-02'))).toBe('Monday, 2 March 2026')
  })

  it('formats a short date with non-breaking spaces so it cannot wrap', () => {
    const short = formatShortDate(key('2026-10-01'))
    expect(short).toBe(`Thu,${NBSP}1${NBSP}Oct${NBSP}2026`)
    expect(short).not.toContain(' ')
    expect(short.replaceAll(NBSP, ' ')).toBe('Thu, 1 Oct 2026')
  })

  it('formats a list row date and month text', () => {
    expect(formatWeekdayDayMonth(key('2026-09-24'))).toBe('Thu 24 Sep')
    expect(formatMonthYear(2026, 9)).toBe('September 2026')
    expect(formatMonthShort(10)).toBe('Oct')
    expect(formatMonthLong(2)).toBe('February')
  })

  it('has the right weekday for the first and last day of 2026', () => {
    expect(formatFullDate(key('2026-01-01'))).toMatch(/^Thursday,/)
    expect(formatFullDate(key('2026-12-31'))).toMatch(/^Thursday,/)
  })
})

describe('formatDistance', () => {
  it('shows one decimal below 100 km', () => {
    expect(formatDistance(42_600)).toBe(`42.6${NBSP}km`)
    expect(formatDistance(0)).toBe(`0.0${NBSP}km`)
    expect(formatDistance(5000)).toBe(`5.0${NBSP}km`)
    expect(formatDistance(99_900)).toBe(`99.9${NBSP}km`)
  })

  it('shows a whole number with thousands separators from 100 km', () => {
    expect(formatDistance(100_000)).toBe(`100${NBSP}km`)
    expect(formatDistance(1_024_300)).toBe(`1,024${NBSP}km`)
    expect(formatDistance(12_345_678)).toBe(`12,346${NBSP}km`)
  })

  it('does not print 100.0 when rounding crosses 100 km', () => {
    expect(formatDistance(99_960)).toBe(`100${NBSP}km`)
  })

  it('treats a negative or non-finite value as 0', () => {
    expect(formatDistance(-5)).toBe(`0.0${NBSP}km`)
    expect(formatDistance(Number.NaN)).toBe(`0.0${NBSP}km`)
  })
})

describe('formatDuration', () => {
  it('uses non-breaking spaces between hours and minutes', () => {
    expect(formatDuration(4440)).toBe(`1h${NBSP}14m`)
    expect(formatDuration(4440)).not.toContain(' ')
    expect(formatDuration(214 * 3600 + 32 * 60)).toBe(`214h${NBSP}32m`)
  })

  it('shows minutes alone under an hour and hours alone on the hour', () => {
    expect(formatDuration(42 * 60)).toBe('42m')
    expect(formatDuration(0)).toBe('0m')
    expect(formatDuration(3600)).toBe('1h')
    expect(formatDuration(2 * 3600)).toBe('2h')
  })

  it('uses consistent thousands separators', () => {
    expect(formatDuration(1024 * 3600)).toBe('1,024h')
    expect(formatDuration(1024 * 3600 + 5 * 60)).toBe(`1,024h${NBSP}5m`)
    expect(formatDuration(999 * 3600)).toBe('999h')
  })

  it('rounds to the nearest minute and carries into the hour', () => {
    expect(formatDuration(59 * 60 + 29)).toBe('59m')
    expect(formatDuration(59 * 60 + 30)).toBe('1h')
    expect(formatDuration(89)).toBe('1m')
    expect(formatDuration(29)).toBe('0m')
  })

  it('treats a negative or non-finite value as 0', () => {
    expect(formatDuration(-60)).toBe('0m')
    expect(formatDuration(Number.NaN)).toBe('0m')
  })
})

describe('formatElevation and counts', () => {
  it('formats elevation with separators and a non-breaking unit space', () => {
    expect(formatElevation(24_680)).toBe(`24,680${NBSP}m`)
    expect(formatElevation(412.4)).toBe(`412${NBSP}m`)
    expect(formatElevation(0)).toBe(`0${NBSP}m`)
  })

  it('pluralises the activity count', () => {
    expect(formatActivityCount(0)).toBe('0 activities')
    expect(formatActivityCount(1)).toBe('1 activity')
    expect(formatActivityCount(2)).toBe('2 activities')
    expect(formatActivityCount(1200)).toBe('1,200 activities')
  })
})

describe('formatLocalTime', () => {
  // 2026-10-04T23:30:00Z
  const instant = Date.UTC(2026, 9, 4, 23, 30)

  it('shows the wall clock in the explicit zone', () => {
    expect(formatLocalTime(instant, 'UTC')).toBe('23:30')
    expect(formatLocalTime(instant, 'Europe/Amsterdam')).toBe('01:30')
    expect(formatLocalTime(instant, 'Asia/Bangkok')).toBe('06:30')
    expect(formatLocalTime(instant, 'America/Los_Angeles')).toBe('16:30')
  })

  it('shows midnight as 00:00', () => {
    expect(formatLocalTime(Date.UTC(2026, 9, 4, 22), 'Europe/Amsterdam')).toBe(
      '00:00'
    )
  })

  it('throws for an unknown zone', () => {
    expect(() => formatLocalTime(instant, 'Not/AZone')).toThrow(RangeError)
  })
})
