import { withTimeZone } from '@/lib/testing/withTimeZone'

import {
  DateKey,
  addDays,
  addMonthsClamped,
  bucketByLocalDay,
  instantAtLocalWallTime,
  localDateKeyAt,
  localDayWindow,
  parseDateKey,
  startOfLocalDay,
  weekdayMon0
} from './localDay'

// This is the only localDay test that moves the process zone. It lives in its
// own file because `withTimeZone` routes its importer to the forked-process
// project, and the rest of the suite is cheaper on worker threads.

const key = (value: string): DateKey => {
  const parsed = parseDateKey(value)
  if (!parsed) throw new Error(`Test fixture is not a date key: ${value}`)
  return parsed
}

const ZONES = [
  'Europe/Amsterdam',
  'America/New_York',
  'America/Santiago',
  'Pacific/Apia',
  'Australia/Lord_Howe',
  'Asia/Kathmandu'
]

const DAYS = [
  '2024-02-29',
  '2026-03-08',
  '2026-03-29',
  '2026-09-06',
  '2026-10-25',
  '2026-11-01',
  '2026-12-31',
  '2011-12-30'
].map(key)

// Every localDay function that takes a zone, evaluated for each zone and day,
// plus the pure date-key arithmetic. Nothing here names the process zone.
const evaluate = () => {
  const instants = [
    Date.UTC(2026, 2, 28, 23, 30),
    Date.UTC(2026, 9, 24, 22, 30),
    Date.UTC(2026, 11, 31, 23, 59, 59),
    Date.UTC(2024, 1, 29, 23, 0),
    0
  ]
  return {
    arithmetic: DAYS.map((day) => [
      addDays(day, 1),
      addDays(day, -31),
      addMonthsClamped(day, -12),
      weekdayMon0(day)
    ]),
    perZone: ZONES.map((timeZone) => ({
      timeZone,
      keys: instants.map((ms) => localDateKeyAt(ms, timeZone)),
      starts: DAYS.map((day) => startOfLocalDay(day, timeZone)),
      windows: DAYS.map((day) =>
        localDayWindow(day, addDays(day, 2), timeZone)
      ),
      wallTimes: ['07:12', '12:00', '23:59'].map((time) =>
        instantAtLocalWallTime(key('2026-06-15'), time, timeZone)
      ),
      buckets: bucketByLocalDay(
        instants.slice().sort((a, b) => a - b),
        timeZone,
        (ms) => ms
      )
    }))
  }
}

const processZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

describe('localDay results do not depend on the process time zone', () => {
  it.each(['Asia/Tokyo', 'America/Los_Angeles'])(
    'returns the UTC-process results when the process is in %s',
    async (zone) => {
      const baseline = evaluate()

      const moved = await withTimeZone(zone, () => {
        expect(processZone()).toBe(zone)
        // The process zone really differs: a local-time Date reads a
        // different offset than it does under UTC.
        expect(new Date(2026, 5, 15).getTimezoneOffset()).not.toBe(0)
        return evaluate()
      })

      expect(moved).toEqual(baseline)
      expect(processZone()).toBe('UTC')
    }
  )

  it.each(['Asia/Tokyo', 'America/Los_Angeles'])(
    'still produces the documented instants when the process is in %s',
    async (zone) => {
      await withTimeZone(zone, () => {
        expect(startOfLocalDay(key('2026-03-29'), 'Europe/Amsterdam')).toBe(
          Date.UTC(2026, 2, 28, 23)
        )
        expect(startOfLocalDay(key('2026-09-06'), 'America/Santiago')).toBe(
          Date.UTC(2026, 8, 6, 4)
        )
        const spring = localDayWindow(
          key('2026-03-29'),
          key('2026-03-29'),
          'Europe/Amsterdam'
        )
        expect(spring.endMs - spring.startMs).toBe(23 * 60 * 60 * 1000)
        const apia = localDayWindow(
          key('2011-12-30'),
          key('2011-12-30'),
          'Pacific/Apia'
        )
        expect(apia.startMs).toBe(apia.endMs)
        expect(addDays(key('2024-02-28'), 1)).toBe('2024-02-29')
        expect(
          localDateKeyAt(Date.UTC(2026, 9, 4, 23, 30), 'Europe/Amsterdam')
        ).toBe('2026-10-05')
      })
    }
  )
})
