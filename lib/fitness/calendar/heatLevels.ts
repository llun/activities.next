/**
 * Heat levels for the calendar cells, one scale per metric.
 *
 * The bands are fixed, absolute numbers. They never depend on the maximum of
 * the visible range, so a day keeps its colour when the range, the month or the
 * selection changes, and the same legend is true on every screen.
 *
 * Values are in the units the API already uses: a count of activities, metres
 * and seconds.
 */

export type HeatMetric = 'count' | 'distance' | 'duration'

/** 0 is a rest day; 4 is the strongest colour. */
export type HeatLevel = 0 | 1 | 2 | 3 | 4

export const HEAT_METRICS: readonly HeatMetric[] = [
  'count',
  'distance',
  'duration'
]

const METERS_PER_KM = 1000
const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600

/**
 * The lower bound (inclusive) of levels 2, 3 and 4. Anything above 0 and below
 * the first bound is level 1.
 *
 * - count: 1, 2, 3, 4+ activities (level n is n activities, 4 and up is 4).
 * - distance: under 10 km, 10-25 km, 25-50 km, 50 km and up.
 * - duration: under 30 min, 30 min-1 h, 1-2 h, 2 h and up.
 */
export const HEAT_THRESHOLDS: Record<
  HeatMetric,
  readonly [number, number, number]
> = {
  count: [2, 3, 4],
  distance: [10 * METERS_PER_KM, 25 * METERS_PER_KM, 50 * METERS_PER_KM],
  duration: [30 * SECONDS_PER_MINUTE, SECONDS_PER_HOUR, 2 * SECONDS_PER_HOUR]
}

export interface HeatDay {
  count: number
  distanceMeters: number
  durationSeconds: number
}

/** The day's value for a metric, in count, metres or seconds. */
export const metricValue = (metric: HeatMetric, day: HeatDay): number => {
  switch (metric) {
    case 'count':
      return day.count
    case 'distance':
      return day.distanceMeters
    case 'duration':
      return day.durationSeconds
  }
}

/**
 * The level of a value in count, metres or seconds. Zero, negative and
 * non-numeric values are level 0 (a rest day).
 */
export const levelFor = (metric: HeatMetric, value: number): HeatLevel => {
  if (!Number.isFinite(value) || value <= 0) return 0
  const [two, three, four] = HEAT_THRESHOLDS[metric]
  if (value >= four) return 4
  if (value >= three) return 3
  if (value >= two) return 2
  return 1
}

export const levelForDay = (metric: HeatMetric, day: HeatDay): HeatLevel =>
  levelFor(metric, metricValue(metric, day))

export interface LegendEntry {
  level: HeatLevel
  /** Text for the legend swatch, units included. */
  label: string
}

const LEGENDS: Record<HeatMetric, readonly LegendEntry[]> = {
  count: [
    { level: 0, label: '0' },
    { level: 1, label: '1' },
    { level: 2, label: '2' },
    { level: 3, label: '3' },
    { level: 4, label: '4+' }
  ],
  distance: [
    { level: 0, label: '0 km' },
    { level: 1, label: '<10 km' },
    { level: 2, label: '10–25 km' },
    { level: 3, label: '25–50 km' },
    { level: 4, label: '50+ km' }
  ],
  duration: [
    { level: 0, label: '0m' },
    { level: 1, label: '<30m' },
    { level: 2, label: '30m–1h' },
    { level: 3, label: '1–2h' },
    { level: 4, label: '2h+' }
  ]
}

/** The legend for a metric: five entries, level 0 first. */
export const legendFor = (metric: HeatMetric): readonly LegendEntry[] =>
  LEGENDS[metric]
