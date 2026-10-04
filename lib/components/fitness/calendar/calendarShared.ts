/**
 * Helpers the calendar components share: the day index, the text a day is
 * announced and previewed with, and the few timings a script has to know.
 *
 * Pure and dependency-light on purpose (no React, no DOM except the two
 * clearly named browser helpers at the bottom), so the wording can be tested
 * without rendering anything.
 */
import {
  formatActivityCount,
  formatDistance,
  formatDuration,
  formatFullDate
} from '@/lib/fitness/calendar/format'
import {
  HeatDay,
  HeatLevel,
  HeatMetric,
  levelForDay
} from '@/lib/fitness/calendar/heatLevels'
import { DateKey } from '@/lib/fitness/calendar/localDay'
import type { FitnessCalendarDay } from '@/lib/fitness/calendar/types'

/**
 * The approved timings a script waits on (decisions.md, "Motion & scroll").
 * The CSS reads the same numbers from the `--fitness-t-*` tokens in
 * app/globals.css; `calendarShared.test.ts` fails if the two drift apart.
 */
export const CALENDAR_MOTION = {
  /** Month and view crossfade: this long out, then this long in. */
  crossfadeHalfMs: 75,
  /** Tooltip: delay before a hover shows one (a focus shows it at once). */
  tooltipHoverDelayMs: 150,
  tooltipInMs: 100,
  tooltipOutMs: 75
} as const

/** The days the API returned, by `YYYY-MM-DD` key. */
export type DayIndex = ReadonlyMap<string, FitnessCalendarDay>

export const indexDays = (days: readonly FitnessCalendarDay[]): DayIndex =>
  new Map(days.map((day) => [day.date, day]))

export const toHeatDay = (day: FitnessCalendarDay | undefined): HeatDay => ({
  count: day?.count ?? 0,
  distanceMeters: day?.totalDistanceMeters ?? 0,
  durationSeconds: day?.totalDurationSeconds ?? 0
})

/** A day's heat level for a metric; a day without an entry is a rest day. */
export const levelOfDay = (
  metric: HeatMetric,
  day: FitnessCalendarDay | undefined
): HeatLevel => levelForDay(metric, toHeatDay(day))

/**
 * What a cell is:
 * - `active`: inside the applied range and not in the future; interactive.
 * - `upcoming`: after today; outlined and disabled (month view).
 * - `out`: outside the applied range; slashed and disabled.
 */
export type CellKind = 'active' | 'upcoming' | 'out'

export interface DayDescription {
  /** The full date: "Thursday, 24 September 2026". */
  title: string
  /** The values, one short phrase each: ["2 activities", "42.6 km", "1h 14m"]. */
  parts: string[]
  /** The cell's accessible name: title and values in one sentence. */
  label: string
  /** The tooltip's second line. */
  detail: string
}

/** The values of a day, one short phrase each. */
export const dayParts = (
  kind: CellKind,
  day: FitnessCalendarDay | undefined
): string[] => {
  if (kind === 'upcoming') return ['Upcoming']
  if (kind === 'out') return ['Outside the selected range']
  if (!day || day.count <= 0) return ['No activities']
  return [
    formatActivityCount(day.count),
    formatDistance(day.totalDistanceMeters),
    formatDuration(day.totalDurationSeconds)
  ]
}

/**
 * The words for one day. A rest day says so; the accessible name always carries
 * the full date and every value, because the cell is a button with no visible
 * text in the annual grid.
 */
export const describeDay = (
  date: DateKey,
  kind: CellKind,
  day: FitnessCalendarDay | undefined
): DayDescription => {
  const title = formatFullDate(date)
  const parts = dayParts(kind, day)
  return {
    title,
    parts,
    label: `${title}: ${parts.join(', ')}`,
    detail: parts.join(' · ')
  }
}

/** The row summary the month list prints: "2 activities · 42.6 km · 1h 14m". */
export const summarizeDay = (day: FitnessCalendarDay | undefined): string =>
  dayParts('active', day).join(' · ')

/** The date key of a calendar cell's element, or null for anything else. */
export const dateOfElement = (
  element: Element | null,
  within: Element
): { date: DateKey; element: HTMLElement } | null => {
  const cell = element?.closest<HTMLElement>('[data-date]') ?? null
  if (!cell || !within.contains(cell)) return null
  const date = cell.dataset.date
  return date ? { date: date as DateKey, element: cell } : null
}

/**
 * `smooth` for a programmatic scroll, `auto` (an instant jump) under
 * prefers-reduced-motion. Read when called, so it follows the setting live.
 */
export const scrollBehavior = (): ScrollBehavior => {
  if (typeof window === 'undefined' || !window.matchMedia) return 'smooth'
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth'
}
