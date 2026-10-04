import {
  DateKey,
  addDays,
  addMonthsClamped,
  bucketByLocalDay,
  canonicalTimeZone,
  compareDateKeys,
  dateKeyParts,
  daysInMonth,
  inclusiveDayCount,
  instantAtLocalWallTime,
  isValidTimeZone,
  localDateKeyAt,
  localDayWindow,
  parseDateKey,
  startOfLocalDay,
  toDateKey,
  weekdayMon0
} from './localDay'

const HOUR = 60 * 60 * 1000

const key = (value: string): DateKey => {
  const parsed = parseDateKey(value)
  if (!parsed) throw new Error(`Test fixture is not a date key: ${value}`)
  return parsed
}

// Local clock reading of an instant in a zone, for asserting where a day starts.
const wallClock = (ms: number, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
    .format(new Date(ms))
    .replace(',', '')

describe('toDateKey and parseDateKey', () => {
  it('zero-pads the parts of a real date', () => {
    expect(toDateKey(2026, 3, 9)).toBe('2026-03-09')
    expect(toDateKey(987, 1, 1)).toBe('0987-01-01')
  })

  it('round-trips through dateKeyParts', () => {
    expect(dateKeyParts(key('2026-10-04'))).toEqual({
      year: 2026,
      month: 10,
      day: 4
    })
  })

  it('round-trips every day from 1970 to 2100', () => {
    let current = key('1970-01-01')
    const last = key('2100-12-31')
    const expectedCount =
      (Date.UTC(2100, 11, 31) - Date.UTC(1970, 0, 1)) / (24 * HOUR)
    let count = 0
    const expected = new Date(Date.UTC(1970, 0, 1))
    while (compareDateKeys(current, last) < 0) {
      const { year, month, day } = dateKeyParts(current)
      expect([year, month, day]).toEqual([
        expected.getUTCFullYear(),
        expected.getUTCMonth() + 1,
        expected.getUTCDate()
      ])
      expect(parseDateKey(toDateKey(year, month, day))).toBe(current)
      current = addDays(current, 1)
      expected.setUTCDate(expected.getUTCDate() + 1)
      count++
    }
    expect(count).toBe(expectedCount)
  })

  it.each([
    ['2026-02-30', 'a day past the end of the month'],
    ['2026-02-29', 'a leap day in a common year'],
    ['2100-02-29', 'a leap day in a century that is not a leap year'],
    ['1900-02-29', 'a leap day in 1900'],
    ['2026-13-01', 'a month 13'],
    ['2026-00-10', 'a month 0'],
    ['2026-04-31', 'the 31st of a 30-day month'],
    ['2026-1-4', 'unpadded parts'],
    ['20261004', 'no separators'],
    ['2026-10-04T00:00:00Z', 'a timestamp'],
    [' 2026-10-04', 'leading whitespace'],
    ['0000-01-01', 'year 0'],
    ['', 'an empty string']
  ])('rejects %s (%s)', (value) => {
    expect(parseDateKey(value)).toBeNull()
  })

  it.each([
    ['2024-02-29', 'a leap day'],
    ['2000-02-29', 'a leap day in a 400-year leap year'],
    ['2100-02-28', 'the last day of February in 2100'],
    ['9999-12-31', 'the last representable day'],
    ['0001-01-01', 'the first representable day']
  ])('accepts %s (%s)', (value) => {
    expect(parseDateKey(value)).toBe(value)
  })

  it('throws a RangeError when asked to build a date that does not exist', () => {
    expect(() => toDateKey(2026, 2, 30)).toThrow(RangeError)
    expect(() => toDateKey(2026, 0, 1)).toThrow(RangeError)
    expect(() => toDateKey(10_000, 1, 1)).toThrow(RangeError)
    expect(() => toDateKey(2026, 1.5, 1)).toThrow(RangeError)
  })
})

describe('daysInMonth', () => {
  it.each([
    [2023, 2, 28],
    [2024, 2, 29],
    [2100, 2, 28],
    [2000, 2, 29],
    [2026, 1, 31],
    [2026, 4, 30],
    [2026, 9, 30],
    [2026, 12, 31]
  ])('year %i month %i has %i days', (year, month, expected) => {
    expect(daysInMonth(year, month)).toBe(expected)
  })

  it('throws a RangeError for a month outside 1-12', () => {
    expect(() => daysInMonth(2026, 0)).toThrow(RangeError)
    expect(() => daysInMonth(2026, 13)).toThrow(RangeError)
  })
})

describe('addDays', () => {
  it.each([
    ['2026-10-04', 1, '2026-10-05'],
    ['2026-10-04', -4, '2026-09-30'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2027-01-01', -1, '2026-12-31'],
    ['2024-02-28', 1, '2024-02-29'],
    ['2024-02-29', 1, '2024-03-01'],
    ['2023-02-28', 1, '2023-03-01'],
    ['2100-02-28', 1, '2100-03-01'],
    ['2024-03-01', -1, '2024-02-29'],
    ['2026-03-29', 0, '2026-03-29'],
    ['2026-01-01', 365, '2027-01-01'],
    ['2024-01-01', 366, '2025-01-01']
  ])('%s plus %i days is %s', (start, days, expected) => {
    expect(addDays(key(start), days)).toBe(expected)
  })

  it('is not affected by a daylight-saving day, which is 23 hours long', () => {
    expect(addDays(key('2026-03-28'), 1)).toBe('2026-03-29')
    expect(addDays(key('2026-03-29'), 1)).toBe('2026-03-30')
    expect(addDays(key('2026-10-24'), 2)).toBe('2026-10-26')
  })

  it('throws a RangeError when the result leaves years 1-9999 or the count is not an integer', () => {
    expect(() => addDays(key('9999-12-31'), 1)).toThrow(RangeError)
    expect(() => addDays(key('0001-01-01'), -1)).toThrow(RangeError)
    expect(() => addDays(key('2026-01-01'), 0.5)).toThrow(RangeError)
    expect(() => addDays(key('2026-01-01'), Number.NaN)).toThrow(RangeError)
  })
})

describe('addMonthsClamped', () => {
  it.each([
    ['2024-02-29', -12, '2023-02-28'],
    ['2024-02-29', 12, '2025-02-28'],
    ['2024-02-29', 48, '2028-02-29'],
    ['2026-10-04', -12, '2025-10-04'],
    ['2026-03-31', -1, '2026-02-28'],
    ['2024-03-31', -1, '2024-02-29'],
    ['2026-01-31', 1, '2026-02-28'],
    ['2026-01-31', 2, '2026-03-31'],
    ['2026-01-31', 3, '2026-04-30'],
    ['2026-12-15', 1, '2027-01-15'],
    ['2026-01-15', -1, '2025-12-15'],
    ['2026-01-15', -13, '2024-12-15'],
    ['2026-06-15', 0, '2026-06-15'],
    ['2025-02-28', -12, '2024-02-28'],
    ['2026-05-31', -3, '2026-02-28']
  ])('%s moved by %i months is %s', (start, months, expected) => {
    expect(addMonthsClamped(key(start), months)).toBe(expected)
  })

  it('throws a RangeError when the result leaves years 1-9999', () => {
    expect(() => addMonthsClamped(key('9999-12-01'), 1)).toThrow(RangeError)
    expect(() => addMonthsClamped(key('0001-01-01'), -1)).toThrow(RangeError)
  })
})

describe('compareDateKeys and inclusiveDayCount', () => {
  it('orders date keys chronologically', () => {
    expect(compareDateKeys(key('2026-01-01'), key('2026-01-02'))).toBe(-1)
    expect(compareDateKeys(key('2026-01-02'), key('2026-01-01'))).toBe(1)
    expect(compareDateKeys(key('2026-01-01'), key('2026-01-01'))).toBe(0)
    expect(compareDateKeys(key('2025-12-31'), key('2026-01-01'))).toBe(-1)
  })

  it.each([
    ['2026-10-04', '2026-10-04', 1],
    ['2026-10-04', '2026-10-10', 7],
    ['2026-01-01', '2026-12-31', 365],
    ['2024-01-01', '2024-12-31', 366],
    ['2025-10-05', '2026-10-04', 365],
    ['2026-03-28', '2026-03-30', 3],
    ['2026-10-05', '2026-10-04', 0],
    ['2026-10-05', '2026-10-03', -1]
  ])('counts %s to %s as %i days', (from, to, expected) => {
    expect(inclusiveDayCount(key(from), key(to))).toBe(expected)
  })
})

describe('weekdayMon0', () => {
  it.each([
    ['2026-10-04', 6, 'a Sunday'],
    ['2026-10-05', 0, 'a Monday'],
    ['2024-01-01', 0, 'the Monday 2024 starts on'],
    ['2025-01-01', 2, 'the Wednesday 2025 starts on'],
    ['2024-02-29', 3, 'a Thursday leap day'],
    ['2026-09-01', 1, 'a Tuesday']
  ])('%s is %i (%s)', (date, expected) => {
    expect(weekdayMon0(key(date))).toBe(expected)
  })
})

describe('time zone validation', () => {
  it.each(['UTC', 'Europe/Amsterdam', 'America/Argentina/Buenos_Aires'])(
    'accepts %s',
    (timeZone) => {
      expect(isValidTimeZone(timeZone)).toBe(true)
    }
  )

  it.each(['Not/AZone', 'Mars/Phobos', '', 'Europe/', ' UTC'])(
    'rejects %j',
    (timeZone) => {
      expect(isValidTimeZone(timeZone)).toBe(false)
    }
  )

  it('rejects a value that is not a string', () => {
    expect(isValidTimeZone(undefined as unknown as string)).toBe(false)
    expect(isValidTimeZone(null as unknown as string)).toBe(false)
  })

  it('returns the canonical spelling of a zone', () => {
    expect(canonicalTimeZone('europe/amsterdam')).toBe('Europe/Amsterdam')
    expect(canonicalTimeZone('Asia/Calcutta')).toMatch(
      /^Asia\/(Calcutta|Kolkata)$/
    )
  })

  it('throws a RangeError from canonicalTimeZone and the zone functions for an unknown zone', () => {
    expect(() => canonicalTimeZone('Not/AZone')).toThrow(RangeError)
    expect(() => canonicalTimeZone('')).toThrow(RangeError)
    expect(() => localDateKeyAt(0, 'Not/AZone')).toThrow(RangeError)
    expect(() => startOfLocalDay(key('2026-10-04'), 'Not/AZone')).toThrow(
      RangeError
    )
    expect(() =>
      localDayWindow(key('2026-10-04'), key('2026-10-04'), 'Not/AZone')
    ).toThrow(RangeError)
    expect(() =>
      instantAtLocalWallTime(key('2026-10-04'), '12:00', 'Not/AZone')
    ).toThrow(RangeError)
  })

  it('throws a RangeError for an instant that is not a finite number', () => {
    expect(() => localDateKeyAt(Number.NaN, 'UTC')).toThrow(RangeError)
    expect(() => localDateKeyAt(Number.POSITIVE_INFINITY, 'UTC')).toThrow(
      RangeError
    )
  })
})

describe('localDateKeyAt', () => {
  it('names the local day an instant falls on', () => {
    const instant = Date.UTC(2026, 9, 4, 23, 30)
    expect(localDateKeyAt(instant, 'UTC')).toBe('2026-10-04')
    expect(localDateKeyAt(instant, 'Europe/Amsterdam')).toBe('2026-10-05')
    expect(localDateKeyAt(instant, 'America/Los_Angeles')).toBe('2026-10-04')
    expect(localDateKeyAt(instant, 'Pacific/Kiritimati')).toBe('2026-10-05')
  })

  it('changes day exactly at local midnight, to the millisecond', () => {
    const midnight = Date.UTC(2026, 9, 4, 22, 0) // 2026-10-05 00:00 CEST
    expect(localDateKeyAt(midnight - 1, 'Europe/Amsterdam')).toBe('2026-10-04')
    expect(localDateKeyAt(midnight, 'Europe/Amsterdam')).toBe('2026-10-05')
  })

  it('handles instants before 1970', () => {
    expect(localDateKeyAt(Date.UTC(1969, 11, 31, 23, 59, 59), 'UTC')).toBe(
      '1969-12-31'
    )
    expect(localDateKeyAt(-1, 'Europe/Amsterdam')).toBe('1970-01-01')
  })

  it('names the leap day', () => {
    expect(localDateKeyAt(Date.UTC(2024, 1, 29, 12), 'Asia/Tokyo')).toBe(
      '2024-02-29'
    )
    expect(localDateKeyAt(Date.UTC(2024, 1, 29, 16), 'Asia/Tokyo')).toBe(
      '2024-03-01'
    )
  })

  it('names the day across a year boundary', () => {
    expect(localDateKeyAt(Date.UTC(2026, 11, 31, 23), 'Asia/Tokyo')).toBe(
      '2027-01-01'
    )
    expect(localDateKeyAt(Date.UTC(2027, 0, 1, 3), 'America/New_York')).toBe(
      '2026-12-31'
    )
  })
})

describe('startOfLocalDay', () => {
  it.each([
    ['UTC', '2026-10-04', Date.UTC(2026, 9, 4)],
    ['Europe/Amsterdam', '2026-01-15', Date.UTC(2026, 0, 14, 23)],
    ['Europe/Amsterdam', '2026-07-15', Date.UTC(2026, 6, 14, 22)],
    ['America/Los_Angeles', '2026-07-15', Date.UTC(2026, 6, 15, 7)],
    ['Asia/Kathmandu', '2026-10-04', Date.UTC(2026, 9, 3, 18, 15)],
    ['Australia/Lord_Howe', '2026-01-15', Date.UTC(2026, 0, 14, 13, 0)],
    ['Pacific/Kiritimati', '2026-10-04', Date.UTC(2026, 9, 3, 10)],
    ['Etc/GMT+12', '2026-10-04', Date.UTC(2026, 9, 4, 12)]
  ])('starts %s %s at the right UTC instant', (timeZone, date, expected) => {
    expect(startOfLocalDay(key(date), timeZone)).toBe(expected)
  })

  const zones = [
    'UTC',
    'Europe/Amsterdam',
    'America/New_York',
    'America/Santiago',
    'America/Havana',
    'Australia/Lord_Howe',
    'Asia/Kathmandu',
    'Pacific/Kiritimati',
    'Etc/GMT+12',
    'America/Sao_Paulo',
    'Pacific/Auckland',
    'Asia/Tokyo'
  ]

  // 2018-11 covers the São Paulo spring-forward that skipped midnight.
  const ranges = [
    ['2018-01-01', '2018-12-31'],
    ['2024-01-01', '2027-01-31']
  ]

  describe.each(zones)('in %s', (timeZone) => {
    it.each(ranges)(
      'begins every local day from %s to %s at its first instant',
      (first, last) => {
        let date = key(first)
        let previousStart = Number.NEGATIVE_INFINITY
        while (compareDateKeys(date, key(last)) <= 0) {
          const start = startOfLocalDay(date, timeZone)
          // The first instant of the day is on that day, and the instant
          // before it is on an earlier one.
          expect(localDateKeyAt(start, timeZone)).toBe(date)
          expect(
            compareDateKeys(localDateKeyAt(start - 1, timeZone), date)
          ).toBe(-1)
          // Days are in order and none is longer than 25 hours or shorter
          // than 23.
          const length = start - previousStart
          if (Number.isFinite(previousStart)) {
            expect(length).toBeGreaterThanOrEqual(22 * HOUR)
            expect(length).toBeLessThanOrEqual(25 * HOUR)
          }
          previousStart = start
          date = addDays(date, 1)
        }
      }
    )
  })

  describe('days that open late because midnight was skipped', () => {
    it.each([
      ['America/Santiago', '2026-09-06'],
      ['America/Havana', '2026-03-08'],
      ['America/Sao_Paulo', '2018-11-04']
    ])('%s %s starts at 01:00 local', (timeZone, date) => {
      const start = startOfLocalDay(key(date), timeZone)
      expect(wallClock(start, timeZone)).toBe(
        `${date.split('-').reverse().join('/')} 01:00`
      )
      expect(localDateKeyAt(start - 1, timeZone)).toBe(addDays(key(date), -1))
    })

    it('makes that day 23 hours long', () => {
      const window = localDayWindow(
        key('2026-09-06'),
        key('2026-09-06'),
        'America/Santiago'
      )
      expect(window.endMs - window.startMs).toBe(23 * HOUR)
    })
  })

  describe('a day that never happened', () => {
    // Samoa skipped Friday 2011-12-30 when it moved across the date line.
    it('gives Pacific/Apia 2011-12-30 an empty window', () => {
      const window = localDayWindow(
        key('2011-12-30'),
        key('2011-12-30'),
        'Pacific/Apia'
      )
      expect(window.startMs).toBe(window.endMs)
      expect(startOfLocalDay(key('2011-12-30'), 'Pacific/Apia')).toBe(
        startOfLocalDay(key('2011-12-31'), 'Pacific/Apia')
      )
    })

    it('keeps the neighbouring days whole', () => {
      const before = localDayWindow(
        key('2011-12-29'),
        key('2011-12-29'),
        'Pacific/Apia'
      )
      const after = localDayWindow(
        key('2011-12-31'),
        key('2011-12-31'),
        'Pacific/Apia'
      )
      expect(before.endMs - before.startMs).toBe(24 * HOUR)
      expect(after.endMs - after.startMs).toBe(24 * HOUR)
      // The window around the skipped day is contiguous with both.
      expect(before.endMs).toBe(after.startMs)
    })

    it('names the day after the skip for an instant right after it', () => {
      const firstInstantOf31st = startOfLocalDay(
        key('2011-12-31'),
        'Pacific/Apia'
      )
      expect(localDateKeyAt(firstInstantOf31st - 1, 'Pacific/Apia')).toBe(
        '2011-12-29'
      )
      expect(localDateKeyAt(firstInstantOf31st, 'Pacific/Apia')).toBe(
        '2011-12-31'
      )
    })
  })

  describe('daylight-saving transitions', () => {
    it.each([
      ['Europe/Amsterdam', '2026-03-29', 23],
      ['Europe/Amsterdam', '2026-10-25', 25],
      ['America/New_York', '2026-03-08', 23],
      ['America/New_York', '2026-11-01', 25],
      ['Australia/Lord_Howe', '2026-10-04', 23.5],
      ['Australia/Lord_Howe', '2026-04-05', 24.5],
      ['Europe/Amsterdam', '2026-03-28', 24],
      ['Europe/Amsterdam', '2026-03-30', 24]
    ])('%s %s is %d hours long', (timeZone, date, hours) => {
      const { startMs, endMs } = localDayWindow(key(date), key(date), timeZone)
      expect(endMs - startMs).toBe(hours * HOUR)
    })

    it('spans a spring-forward week in 167 hours, not 168', () => {
      const { startMs, endMs } = localDayWindow(
        key('2026-03-26'),
        key('2026-04-01'),
        'Europe/Amsterdam'
      )
      expect(endMs - startMs).toBe(167 * HOUR)
    })
  })

  describe('year, month and leap-day boundaries', () => {
    it('starts January 1 in the previous UTC year for a zone ahead of UTC', () => {
      expect(startOfLocalDay(key('2026-01-01'), 'Asia/Tokyo')).toBe(
        Date.UTC(2025, 11, 31, 15)
      )
    })

    it('puts the end of a year at the start of the next one', () => {
      const { startMs, endMs } = localDayWindow(
        key('2026-01-01'),
        key('2026-12-31'),
        'America/New_York'
      )
      expect(startMs).toBe(Date.UTC(2026, 0, 1, 5))
      expect(endMs).toBe(Date.UTC(2027, 0, 1, 5))
    })

    it('covers a leap day as an ordinary 24-hour day', () => {
      const { startMs, endMs } = localDayWindow(
        key('2024-02-29'),
        key('2024-02-29'),
        'Europe/Amsterdam'
      )
      expect(startMs).toBe(Date.UTC(2024, 1, 28, 23))
      expect(endMs - startMs).toBe(24 * HOUR)
    })

    it('runs February 2024 for 29 days and February 2026 for 28', () => {
      const leap = localDayWindow(key('2024-02-01'), key('2024-02-29'), 'UTC')
      const common = localDayWindow(key('2026-02-01'), key('2026-02-28'), 'UTC')
      expect((leap.endMs - leap.startMs) / (24 * HOUR)).toBe(29)
      expect((common.endMs - common.startMs) / (24 * HOUR)).toBe(28)
    })
  })

  it('stays correct for dates before 1970 and in the far future', () => {
    expect(startOfLocalDay(key('1950-06-15'), 'UTC')).toBe(
      Date.UTC(1950, 5, 15)
    )
    expect(
      localDateKeyAt(
        startOfLocalDay(key('2099-07-01'), 'Europe/Amsterdam'),
        'Europe/Amsterdam'
      )
    ).toBe('2099-07-01')
  })
})

describe('localDayWindow', () => {
  it('ends exclusively at the start of the day after the last day', () => {
    const { startMs, endMs } = localDayWindow(
      key('2026-10-01'),
      key('2026-10-04'),
      'Europe/Amsterdam'
    )
    expect(startMs).toBe(startOfLocalDay(key('2026-10-01'), 'Europe/Amsterdam'))
    expect(endMs).toBe(startOfLocalDay(key('2026-10-05'), 'Europe/Amsterdam'))
    expect(localDateKeyAt(endMs - 1, 'Europe/Amsterdam')).toBe('2026-10-04')
    expect(localDateKeyAt(endMs, 'Europe/Amsterdam')).toBe('2026-10-05')
  })

  it('accepts a single day and rejects a range that ends before it starts', () => {
    expect(
      localDayWindow(key('2026-10-04'), key('2026-10-04'), 'UTC').endMs
    ).toBe(Date.UTC(2026, 9, 5))
    expect(() =>
      localDayWindow(key('2026-10-05'), key('2026-10-04'), 'UTC')
    ).toThrow(RangeError)
  })

  it('joins adjacent ranges without a gap or an overlap', () => {
    const first = localDayWindow(
      key('2026-03-25'),
      key('2026-03-29'),
      'Europe/Amsterdam'
    )
    const second = localDayWindow(
      key('2026-03-30'),
      key('2026-04-02'),
      'Europe/Amsterdam'
    )
    expect(first.endMs).toBe(second.startMs)
  })
})

describe('instantAtLocalWallTime', () => {
  it('returns the instant a zone clock reads the given time', () => {
    expect(
      instantAtLocalWallTime(key('2026-07-15'), '07:12', 'Europe/Amsterdam')
    ).toBe(Date.UTC(2026, 6, 15, 5, 12))
    expect(
      instantAtLocalWallTime(key('2026-01-15'), '23:30', 'America/Los_Angeles')
    ).toBe(Date.UTC(2026, 0, 16, 7, 30))
    expect(
      instantAtLocalWallTime(key('2026-10-04'), '00:00', 'Asia/Kathmandu')
    ).toBe(startOfLocalDay(key('2026-10-04'), 'Asia/Kathmandu'))
  })

  it('lands on the day it names', () => {
    const instant = instantAtLocalWallTime(
      key('2026-03-29'),
      '23:59',
      'Europe/Amsterdam'
    )
    expect(localDateKeyAt(instant, 'Europe/Amsterdam')).toBe('2026-03-29')
  })

  it('picks the earlier instant when the clock reads the time twice', () => {
    // 2026-10-25 02:30 happens at 00:30Z (CEST) and again at 01:30Z (CET).
    expect(
      instantAtLocalWallTime(key('2026-10-25'), '02:30', 'Europe/Amsterdam')
    ).toBe(Date.UTC(2026, 9, 25, 0, 30))
  })

  it('reads times either side of a repeated hour as single instants', () => {
    expect(
      instantAtLocalWallTime(key('2026-10-25'), '01:59', 'Europe/Amsterdam')
    ).toBe(Date.UTC(2026, 9, 24, 23, 59))
    expect(
      instantAtLocalWallTime(key('2026-10-25'), '03:00', 'Europe/Amsterdam')
    ).toBe(Date.UTC(2026, 9, 25, 2, 0))
  })

  it('throws a RangeError for a time the clock skipped', () => {
    expect(() =>
      instantAtLocalWallTime(key('2026-03-29'), '02:30', 'Europe/Amsterdam')
    ).toThrow(RangeError)
    expect(() =>
      instantAtLocalWallTime(key('2026-09-06'), '00:30', 'America/Santiago')
    ).toThrow(RangeError)
  })

  it('throws a RangeError for a malformed time', () => {
    expect(() =>
      instantAtLocalWallTime(key('2026-10-04'), '7:12', 'UTC')
    ).toThrow(RangeError)
    expect(() =>
      instantAtLocalWallTime(key('2026-10-04'), '24:00', 'UTC')
    ).toThrow(RangeError)
    expect(() =>
      instantAtLocalWallTime(key('2026-10-04'), '12:60', 'UTC')
    ).toThrow(RangeError)
  })
})

describe('bucketByLocalDay', () => {
  type Row = { id: string; ms: number }
  const getMs = (row: Row) => row.ms
  const row = (
    id: string,
    date: string,
    time: string,
    timeZone: string
  ): Row => ({
    id,
    ms: instantAtLocalWallTime(key(date), time, timeZone)
  })
  const summarize = (buckets: ReturnType<typeof bucketByLocalDay<Row>>) =>
    buckets.map((bucket) => [bucket.date, bucket.rows.map((r) => r.id)])

  it('returns no buckets for no rows', () => {
    expect(bucketByLocalDay([], 'UTC', getMs)).toEqual([])
  })

  it.each(['Europe/Amsterdam', 'America/Los_Angeles', 'Asia/Tokyo'])(
    'files early-morning and late-night rows under their local day in %s',
    (timeZone) => {
      const rows = [
        row('late-night-before', '2026-10-03', '23:30', timeZone),
        row('just-after-midnight', '2026-10-04', '00:30', timeZone),
        row('early-morning', '2026-10-04', '05:10', timeZone),
        row('noon', '2026-10-04', '12:00', timeZone),
        row('late-night', '2026-10-04', '23:59', timeZone),
        row('next-midnight', '2026-10-05', '00:00', timeZone)
      ]
      expect(summarize(bucketByLocalDay(rows, timeZone, getMs))).toEqual([
        ['2026-10-03', ['late-night-before']],
        [
          '2026-10-04',
          ['just-after-midnight', 'early-morning', 'noon', 'late-night']
        ],
        ['2026-10-05', ['next-midnight']]
      ])
    }
  )

  it('files a row differently from its UTC date when the zone is far from UTC', () => {
    // 23:30 on 2026-10-04 in Los Angeles is 06:30Z on the 5th.
    const rows = [row('evening', '2026-10-04', '23:30', 'America/Los_Angeles')]
    expect(bucketByLocalDay(rows, 'America/Los_Angeles', getMs)[0].date).toBe(
      '2026-10-04'
    )
    expect(bucketByLocalDay(rows, 'UTC', getMs)[0].date).toBe('2026-10-05')
  })

  it('puts a row at exactly the start of a day in that day and the instant before in the previous one', () => {
    const timeZone = 'Europe/Amsterdam'
    const start = startOfLocalDay(key('2026-10-04'), timeZone)
    const rows: Row[] = [
      { id: 'before', ms: start - 1 },
      { id: 'at', ms: start }
    ]
    expect(summarize(bucketByLocalDay(rows, timeZone, getMs))).toEqual([
      ['2026-10-03', ['before']],
      ['2026-10-04', ['at']]
    ])
  })

  it('gives a spring-forward day its 23 hours and a fall-back day its 25', () => {
    const springZone = 'Europe/Amsterdam'
    const spring = [
      row('last-of-28th', '2026-03-28', '23:59', springZone),
      row('first-of-29th', '2026-03-29', '00:00', springZone),
      row('last-of-29th', '2026-03-29', '23:59', springZone),
      row('first-of-30th', '2026-03-30', '00:00', springZone)
    ]
    expect(summarize(bucketByLocalDay(spring, springZone, getMs))).toEqual([
      ['2026-03-28', ['last-of-28th']],
      ['2026-03-29', ['first-of-29th', 'last-of-29th']],
      ['2026-03-30', ['first-of-30th']]
    ])

    const fallStart = startOfLocalDay(key('2026-10-25'), springZone)
    const fall: Row[] = [
      { id: 'first', ms: fallStart },
      { id: 'repeated-hour-first', ms: fallStart + 2.5 * HOUR },
      { id: 'repeated-hour-second', ms: fallStart + 3.5 * HOUR },
      { id: 'last', ms: fallStart + 25 * HOUR - 1 },
      { id: 'next-day', ms: fallStart + 25 * HOUR }
    ]
    expect(summarize(bucketByLocalDay(fall, springZone, getMs))).toEqual([
      [
        '2026-10-25',
        ['first', 'repeated-hour-first', 'repeated-hour-second', 'last']
      ],
      ['2026-10-26', ['next-day']]
    ])
  })

  it('files rows on a leap day and the days around it', () => {
    const timeZone = 'America/Los_Angeles'
    const rows = [
      row('feb28', '2024-02-28', '12:00', timeZone),
      row('feb29', '2024-02-29', '12:00', timeZone),
      row('mar01', '2024-03-01', '12:00', timeZone)
    ]
    expect(bucketByLocalDay(rows, timeZone, getMs).map((b) => b.date)).toEqual([
      '2024-02-28',
      '2024-02-29',
      '2024-03-01'
    ])
  })

  it('files rows across a year boundary', () => {
    const timeZone = 'Asia/Tokyo'
    const rows = [
      row('new-years-eve', '2026-12-31', '23:59', timeZone),
      row('new-years-day', '2027-01-01', '00:00', timeZone)
    ]
    expect(bucketByLocalDay(rows, timeZone, getMs).map((b) => b.date)).toEqual([
      '2026-12-31',
      '2027-01-01'
    ])
  })

  it('opens a day that begins at 01:00 with its first row', () => {
    const timeZone = 'America/Santiago'
    const rows = [
      row('before', '2026-09-05', '23:30', timeZone),
      row('first-hour', '2026-09-06', '01:00', timeZone)
    ]
    expect(summarize(bucketByLocalDay(rows, timeZone, getMs))).toEqual([
      ['2026-09-05', ['before']],
      ['2026-09-06', ['first-hour']]
    ])
  })

  it('skips Samoa 2011-12-30 because no row can fall on it', () => {
    const timeZone = 'Pacific/Apia'
    const rows: Row[] = [
      { id: 'last', ms: startOfLocalDay(key('2011-12-31'), timeZone) - 1 },
      { id: 'first', ms: startOfLocalDay(key('2011-12-31'), timeZone) }
    ]
    expect(summarize(bucketByLocalDay(rows, timeZone, getMs))).toEqual([
      ['2011-12-29', ['last']],
      ['2011-12-31', ['first']]
    ])
  })

  it('agrees with the window of every day it reports', () => {
    const timeZone = 'America/Santiago'
    const rows: Row[] = []
    for (let hour = 0; hour < 24 * 400; hour += 7) {
      rows.push({
        id: String(hour),
        ms: Date.UTC(2025, 7, 1) + hour * HOUR
      })
    }
    for (const bucket of bucketByLocalDay(rows, timeZone, getMs)) {
      const { startMs, endMs } = localDayWindow(
        bucket.date,
        bucket.date,
        timeZone
      )
      for (const bucketRow of bucket.rows) {
        expect(bucketRow.ms).toBeGreaterThanOrEqual(startMs)
        expect(bucketRow.ms).toBeLessThan(endMs)
      }
    }
  })

  it('does not mutate the input rows', () => {
    const rows = [row('a', '2026-10-04', '10:00', 'UTC')]
    const copy = structuredClone(rows)
    bucketByLocalDay(rows, 'UTC', getMs)
    expect(rows).toEqual(copy)
  })

  it('throws a RangeError for rows out of order or an instant that is not finite', () => {
    expect(() =>
      bucketByLocalDay(
        [
          { id: 'b', ms: 2000 },
          { id: 'a', ms: 1000 }
        ],
        'UTC',
        getMs
      )
    ).toThrow(RangeError)
    expect(() =>
      bucketByLocalDay([{ id: 'nan', ms: Number.NaN }], 'UTC', getMs)
    ).toThrow(RangeError)
  })
})
