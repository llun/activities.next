/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import type { FitnessCalendarDay } from '@/lib/fitness/calendar/types'

import {
  CALENDAR_MOTION,
  describeDay,
  indexDays,
  levelOfDay,
  scrollBehavior,
  summarizeDay
} from './calendarShared'
import { key, stubReducedMotion } from './calendarTestDoubles'

const ride: FitnessCalendarDay = {
  date: '2026-09-24',
  count: 2,
  totalDistanceMeters: 42_600,
  totalDurationSeconds: 4440,
  totalElevationGainMeters: 310
}

describe('describeDay', () => {
  it('names the full date and every value for an active day', () => {
    const description = describeDay(key('2026-09-24'), 'active', ride)

    expect(description.title).toBe('Thursday, 24 September 2026')
    expect(description.label).toBe(
      'Thursday, 24 September 2026: 2 activities, 42.6\u00a0km, 1h\u00a014m'
    )
    expect(description.detail).toBe('2 activities · 42.6\u00a0km · 1h\u00a014m')
  })

  it.each([
    ['a day without data', undefined, 'No activities'],
    ['a day recorded with a zero count', { ...ride, count: 0 }, 'No activities']
  ])('says a rest day is a rest day: %s', (_name, day, text) => {
    expect(describeDay(key('2026-09-25'), 'active', day).detail).toBe(text)
  })

  it('does not report values for an upcoming day or one outside the range', () => {
    expect(describeDay(key('2026-10-20'), 'upcoming', ride).detail).toBe(
      'Upcoming'
    )
    expect(describeDay(key('2025-01-01'), 'out', ride).detail).toBe(
      'Outside the selected range'
    )
  })

  it('summarises a day for the month list', () => {
    expect(summarizeDay(ride)).toBe('2 activities · 42.6\u00a0km · 1h\u00a014m')
    expect(summarizeDay(undefined)).toBe('No activities')
  })
})

describe('day index', () => {
  it('finds a day by key and treats a missing day as a rest day', () => {
    const index = indexDays([ride])

    expect(index.get('2026-09-24')).toBe(ride)
    expect(levelOfDay('count', index.get('2026-09-24'))).toBe(2)
    expect(levelOfDay('count', index.get('2026-09-25'))).toBe(0)
  })

  it('shades by the chosen metric with fixed thresholds', () => {
    const shortLongRide = {
      ...ride,
      totalDistanceMeters: 5_000,
      totalDurationSeconds: 3 * 3600
    }

    expect(levelOfDay('count', shortLongRide)).toBe(2)
    expect(levelOfDay('distance', shortLongRide)).toBe(1)
    expect(levelOfDay('duration', shortLongRide)).toBe(4)
  })
})

describe('scrollBehavior', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('glides by default', () => {
    stubReducedMotion(false)

    expect(scrollBehavior()).toBe('smooth')
  })

  it('jumps instantly under prefers-reduced-motion', () => {
    stubReducedMotion(true)

    expect(scrollBehavior()).toBe('auto')
  })
})

describe('calendar motion timings', () => {
  const css = readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8')
  const token = (name: string) =>
    Number(css.match(new RegExp(`${name}:\\s*(\\d+)ms`))?.[1])

  it('mirror the CSS tokens a script waits on', () => {
    expect(CALENDAR_MOTION.crossfadeHalfMs).toBe(
      token('--fitness-t-xfade-half')
    )
    expect(CALENDAR_MOTION.tooltipInMs).toBe(token('--fitness-t-tip-in'))
    expect(CALENDAR_MOTION.tooltipOutMs).toBe(token('--fitness-t-tip-out'))
  })
})
