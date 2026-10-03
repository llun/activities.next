import { formatCompactRelativeTime } from './compactRelativeTime'

const NOW = Date.UTC(2026, 9, 2, 12, 0, 0)
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const ago = (ms: number) => formatCompactRelativeTime(NOW - ms, NOW)

describe('formatCompactRelativeTime', () => {
  describe('under a minute', () => {
    it.each([
      ['the same instant', 0],
      ['one second', SECOND],
      ['a few seconds', 12 * SECOND],
      ['the last second of the minute', MINUTE - SECOND]
    ])('reads "now" for %s', (_label, ms) => {
      expect(ago(ms)).toBe('now')
    })

    it('reads "now" for a timestamp ahead of the clock', () => {
      expect(ago(-5 * MINUTE)).toBe('now')
    })

    it('reads "now" when either side is not a valid time', () => {
      expect(formatCompactRelativeTime(Number.NaN, NOW)).toBe('now')
      expect(formatCompactRelativeTime(NOW, Number.NaN)).toBe('now')
    })
  })

  describe('minutes', () => {
    it.each([
      [MINUTE, '1m'],
      [35 * MINUTE, '35m'],
      [59 * MINUTE + 59 * SECOND, '59m']
    ])('formats %i ms as %s', (ms, expected) => {
      expect(ago(ms)).toBe(expected)
    })
  })

  describe('hours', () => {
    it.each([
      [HOUR, '1h'],
      [HOUR + 59 * MINUTE, '1h'],
      [2 * HOUR, '2h'],
      [23 * HOUR + 59 * MINUTE, '23h']
    ])('formats %i ms as %s', (ms, expected) => {
      expect(ago(ms)).toBe(expected)
    })
  })

  describe('days', () => {
    it.each([
      [DAY, '1d'],
      [3 * DAY, '3d'],
      [3 * DAY + 23 * HOUR, '3d'],
      [7 * DAY - SECOND, '6d']
    ])('formats %i ms as %s', (ms, expected) => {
      expect(ago(ms)).toBe(expected)
    })
  })

  describe('older posts', () => {
    it.each([
      [7 * DAY, '1w'],
      [15 * DAY, '2w'],
      [27 * DAY, '3w'],
      [30 * DAY - SECOND, '4w'],
      [30 * DAY, '1mo'],
      [59 * DAY, '1mo'],
      [60 * DAY, '2mo'],
      [364 * DAY, '11mo'],
      [365 * DAY, '1y'],
      [600 * DAY, '1y'],
      [800 * DAY, '2y']
    ])('formats %i ms as %s', (ms, expected) => {
      expect(ago(ms)).toBe(expected)
    })
  })

  it('accepts Date objects as well as epoch milliseconds', () => {
    expect(
      formatCompactRelativeTime(new Date(NOW - 2 * HOUR), new Date(NOW))
    ).toBe('2h')
  })

  it('does not depend on the time zone of the runtime', () => {
    // Midnight-crossing: a calendar-date format would disagree between zones,
    // a pure difference cannot.
    const lateEvening = Date.UTC(2026, 9, 1, 23, 30, 0)
    const earlyMorning = Date.UTC(2026, 9, 2, 0, 15, 0)
    expect(formatCompactRelativeTime(lateEvening, earlyMorning)).toBe('45m')
  })
})
