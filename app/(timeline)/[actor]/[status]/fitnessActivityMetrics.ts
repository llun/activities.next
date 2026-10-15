import type {
  FitnessMetricSample,
  FitnessRouteLap,
  FitnessRouteSample
} from '@/lib/client/fitnessRoutes'
import type { AnalysisSeriesKey } from '@/lib/components/fitness/palette'
import { normalizeActivityTypeToSportKey } from '@/lib/services/fitness-files/sportTypes'

import {
  computePowerHistogramMinutes,
  downsampleSeries,
  getSeriesMinMax
} from './fitnessChartData'

/**
 * Derived metrics for the activity page, computed in the browser from the
 * route-data payload (`GET /api/v1/fitness-files/:id/route-data`). Nothing
 * here is stored: normalized power, best efforts, the power curve, climbs and
 * per-lap averages are all recomputed from the file's own samples, so an
 * activity imported before any of this existed gets them too.
 *
 * Two kinds of input feed these helpers, and they are not interchangeable:
 *
 * - The full-resolution series (`powerSeries`, `heartRateSeries`, …) carry
 *   every recorded value of one metric, with missing readings dropped. They are
 *   what power maths needs (a 5 s best effort cannot come from 1,500 points
 *   spread over two hours), and they are read as evenly spaced in time.
 * - The timeline (`samples`, or `metricSamples` for an activity with no GPS
 *   track) is at most 1,500 points, each carrying every metric recorded at its
 *   own elapsed time. Anything that has to line metrics up with each other or
 *   with a time range (charts, laps, climbs, decoupling) reads the timeline.
 */

export interface ActivityPoint {
  /** Seconds since the file's first record. */
  elapsedSeconds: number
  /** Cumulative distance in meters; null when the file gives no way to tell. */
  distanceMeters: number | null
  timestamp?: number
  lat?: number
  lng?: number
  altitude?: number
  /** km/h */
  speed?: number
  power?: number
  heartRate?: number
  /** rpm, or steps per minute for a run (see `getCadenceMultiplier`). */
  cadence?: number
  temperature?: number
  /** Percent of power from the left leg, 0-100. */
  leftRightBalance?: number
}

export interface TimeRange {
  startSeconds: number
  endSeconds: number
}

const EARTH_RADIUS_METERS = 6_371_000

const toRadians = (degrees: number) => (degrees * Math.PI) / 180

export const haversineMeters = (
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): number => {
  const dLat = toRadians(to.lat - from.lat)
  const dLng = toRadians(to.lng - from.lng)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) *
      Math.cos(toRadians(to.lat)) *
      Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)))
}

export const isRunActivity = (activityType?: string | null): boolean => {
  const key = normalizeActivityTypeToSportKey(activityType)
  return key === 'run' || key === 'trail_run'
}

/**
 * Above this median, a run's recorded cadence is already in steps per minute:
 * per-foot running cadence sits around 75-100, and no runner holds 120
 * strides (240 steps) a minute, while 150-200 is an ordinary step rate.
 */
export const RUN_CADENCE_STEPS_THRESHOLD = 120

const median = (values: number[]): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * Running cadence is usually recorded per foot (strides per minute), and
 * runners read it in steps per minute, so a run's cadence is doubled. Some
 * devices already record steps per minute; a run whose median recorded cadence
 * (ignoring zeros) is above {@link RUN_CADENCE_STEPS_THRESHOLD} is shown as
 * recorded. Every other sport (cycling's rpm in particular) is shown as
 * recorded.
 */
export const getCadenceMultiplier = (
  activityType?: string | null,
  rawCadences: Array<number | null | undefined> = []
): number => {
  if (!isRunActivity(activityType)) return 1
  const typical = median(
    rawCadences.filter(
      (value): value is number => typeof value === 'number' && value > 0
    )
  )
  return typical !== null && typical > RUN_CADENCE_STEPS_THRESHOLD ? 1 : 2
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const hasCoordinates = (
  sample: FitnessRouteSample | FitnessMetricSample
): sample is FitnessRouteSample =>
  isFiniteNumber((sample as FitnessRouteSample).lat) &&
  isFiniteNumber((sample as FitnessRouteSample).lng)

/**
 * One time-ordered list of points from whichever per-point data the payload
 * has: the GPS samples, or the metric samples of an activity recorded without
 * GPS. Distance comes from the file's own cumulative distance where a point
 * has it, and is otherwise measured: along the GPS track, or by integrating
 * speed over time when there is no track. When neither is possible every
 * point's distance is null.
 */
export const buildActivityTimeline = ({
  samples,
  metricSamples,
  cadenceMultiplier = 1
}: {
  samples: FitnessRouteSample[]
  metricSamples?: FitnessMetricSample[]
  cadenceMultiplier?: number
}): ActivityPoint[] => {
  const source: Array<FitnessRouteSample | FitnessMetricSample> =
    samples.length > 0 ? samples : (metricSamples ?? [])
  if (source.length === 0) return []

  const sorted = [...source].sort((a, b) => a.elapsedSeconds - b.elapsedSeconds)
  let distance = 0
  let hasDistance = false

  const points = sorted.map((sample, index): ActivityPoint => {
    const previous = index > 0 ? sorted[index - 1] : null
    if (isFiniteNumber(sample.distanceMeters)) {
      distance = sample.distanceMeters
      hasDistance = true
    } else if (previous) {
      if (hasCoordinates(sample) && hasCoordinates(previous)) {
        distance += haversineMeters(previous, sample)
        hasDistance = true
      } else if (isFiniteNumber(sample.speed)) {
        const seconds = Math.max(
          0,
          sample.elapsedSeconds - previous.elapsedSeconds
        )
        distance += (sample.speed / 3.6) * seconds
        hasDistance = true
      }
    }

    const point: ActivityPoint = {
      elapsedSeconds: sample.elapsedSeconds,
      distanceMeters: distance
    }
    if (isFiniteNumber(sample.timestamp)) point.timestamp = sample.timestamp
    if (hasCoordinates(sample)) {
      point.lat = sample.lat
      point.lng = sample.lng
    }
    if (isFiniteNumber(sample.altitude)) point.altitude = sample.altitude
    if (isFiniteNumber(sample.speed)) point.speed = sample.speed
    if (isFiniteNumber(sample.power)) point.power = sample.power
    if (isFiniteNumber(sample.heartRate) && sample.heartRate > 0) {
      point.heartRate = sample.heartRate
    }
    if (isFiniteNumber(sample.cadence)) {
      point.cadence = sample.cadence * cadenceMultiplier
    }
    if (isFiniteNumber(sample.temperature)) {
      point.temperature = sample.temperature
    }
    if (isFiniteNumber(sample.leftRightBalance)) {
      point.leftRightBalance = sample.leftRightBalance
    }
    return point
  })

  if (!hasDistance) {
    return points.map((point) => ({ ...point, distanceMeters: null }))
  }
  return points
}

/** Half the distance window a grade is measured over, either side of a point. */
export const GRADE_HALF_WINDOW_METERS = 50
/** A window shorter than this (a stop, a GPS gap) gives no grade. */
export const GRADE_MIN_RUN_METERS = 20
/** Grades past this are altimeter noise, not road. */
export const MAX_GRADE_PERCENT = 30

/**
 * Road grade at every point, in percent: the altitude change over the distance
 * covered within ±50 m of the point. A window is used rather than neighbouring
 * points because the altimeter and GPS both step in coarse increments, and a
 * 1 m altitude step over a 2 m GPS step would read as a 50% wall. Null where
 * the point has no altitude or distance, or the window is too short.
 */
export const computeGradeSeries = (
  points: ActivityPoint[]
): Array<number | null> => {
  const usable = points
    .map((point, index) => ({ point, index }))
    .filter(
      ({ point }) =>
        isFiniteNumber(point.altitude) && isFiniteNumber(point.distanceMeters)
    )
  const grades: Array<number | null> = points.map(() => null)
  let low = 0
  let high = 0
  for (let i = 0; i < usable.length; i += 1) {
    const distance = usable[i].point.distanceMeters as number
    // The window reaches the first point at or past each edge, so sparse
    // points (a long ride's samples can be 100 m apart) still have a grade.
    while (
      low + 1 <= i &&
      (usable[low + 1].point.distanceMeters as number) <=
        distance - GRADE_HALF_WINDOW_METERS
    ) {
      low += 1
    }
    if (high < i) high = i
    while (
      high + 1 < usable.length &&
      (usable[high].point.distanceMeters as number) <
        distance + GRADE_HALF_WINDOW_METERS
    ) {
      high += 1
    }
    const run =
      (usable[high].point.distanceMeters as number) -
      (usable[low].point.distanceMeters as number)
    if (run < GRADE_MIN_RUN_METERS) continue
    const rise =
      (usable[high].point.altitude as number) -
      (usable[low].point.altitude as number)
    const grade = (rise / run) * 100
    grades[usable[i].index] = Math.max(
      -MAX_GRADE_PERCENT,
      Math.min(MAX_GRADE_PERCENT, grade)
    )
  }
  return grades
}

/** Gaps of up to this many empty bins are bridged when a series is binned. */
export const MAX_BRIDGED_EMPTY_BINS = 3

/**
 * Averages `values` (one per timeline point, null where the point has none)
 * into `binCount` equal slices of the activity's elapsed time. A bin with no
 * reading is null; a run of up to three empty bins between two readings is
 * bridged by a straight line, so uneven sample spacing does not break a line,
 * while a real gap (a pause, a sensor dropping out) still does.
 */
export const binValuesByTime = (
  points: ActivityPoint[],
  values: Array<number | null | undefined>,
  durationSeconds: number,
  binCount: number
): Array<number | null> => {
  if (binCount <= 0 || durationSeconds <= 0) return []
  const sums = new Array<number>(binCount).fill(0)
  const counts = new Array<number>(binCount).fill(0)
  points.forEach((point, index) => {
    const value = values[index]
    if (!isFiniteNumber(value)) return
    const bin = Math.min(
      binCount - 1,
      Math.max(
        0,
        Math.floor((point.elapsedSeconds / durationSeconds) * binCount)
      )
    )
    sums[bin] += value
    counts[bin] += 1
  })
  const binned: Array<number | null> = sums.map((sum, bin) =>
    counts[bin] > 0 ? sum / counts[bin] : null
  )

  let lastFilled = -1
  for (let bin = 0; bin < binCount; bin += 1) {
    if (binned[bin] === null) continue
    const gap = bin - lastFilled - 1
    if (lastFilled >= 0 && gap > 0 && gap <= MAX_BRIDGED_EMPTY_BINS) {
      const from = binned[lastFilled] as number
      const to = binned[bin] as number
      for (let step = 1; step <= gap; step += 1) {
        binned[lastFilled + step] = from + ((to - from) * step) / (gap + 1)
      }
    }
    lastFilled = bin
  }
  return binned
}

/**
 * Spreads a full-resolution series evenly over `binCount` bins, for a metric
 * the file has as a series but not per timeline point. The series is read as
 * evenly spaced over the activity, which is how every chart here has always
 * drawn it.
 */
export const spreadSeriesOverBins = (
  series: number[],
  binCount: number
): Array<number | null> => {
  if (series.length === 0 || binCount <= 0) return []
  if (series.length >= binCount) return downsampleSeries(series, binCount)
  return Array.from(
    { length: binCount },
    (_, bin) => series[Math.floor((bin * series.length) / binCount)]
  )
}

export interface SeriesScale {
  min: number
  max: number
}

/**
 * The y range each series is drawn over. Power, speed and cadence start at
 * zero (a bar of nothing is meaningful); elevation, heart rate and temperature
 * are fitted to what was recorded with some headroom; grade is symmetric
 * around flat so a climb and a descent read as mirror images.
 */
export const getSeriesScale = (
  key: AnalysisSeriesKey,
  values: Array<number | null>
): SeriesScale => {
  const present = values.filter(isFiniteNumber)
  if (present.length === 0) return { min: 0, max: 1 }
  const { minValue, maxValue } = getSeriesMinMax(present)
  const range = Math.max(1, maxValue - minValue)
  switch (key) {
    case 'power':
    case 'speed':
    case 'cadence':
      return { min: 0, max: Math.max(1, maxValue * 1.04) }
    case 'temperature':
      return { min: Math.floor(minValue) - 2, max: Math.ceil(maxValue) + 2 }
    case 'grade': {
      const extent = Math.min(
        MAX_GRADE_PERCENT,
        Math.max(5, Math.ceil(Math.max(Math.abs(minValue), Math.abs(maxValue))))
      )
      return { min: -extent, max: extent }
    }
    case 'elevation':
      return { min: minValue - range * 0.1, max: maxValue + range * 0.1 }
    case 'heart-rate':
    default:
      return {
        min: Math.max(0, minValue - range * 0.1),
        max: maxValue + range * 0.05
      }
  }
}

/**
 * Seconds between two values of a full-resolution series, given how long the
 * recording was actually running (see {@link estimateRecordingSeconds}). The
 * series keeps only recorded values, so it is read as one per second unless
 * the recording is clearly sparser (Garmin's "smart recording" writes every
 * few seconds). Pass running time, never elapsed time: an auto-paused file has
 * no samples for its stops, so elapsed time would stretch every sample, shrink
 * the windows the power maths slides over and inflate every time total.
 */
export const estimateSampleSeconds = (
  sampleCount: number,
  durationSeconds: number
): number => {
  if (sampleCount < 2 || !(durationSeconds > 0)) return 1
  const ratio = durationSeconds / sampleCount
  return ratio < 1.5 ? 1 : ratio
}

/**
 * How long the recording was running, from the timeline's own timing: the sum
 * of the gaps between consecutive points, where a gap far longer than the
 * usual one (an auto-pause, or the recorder stopped) counts as one usual gap,
 * capped at `fallbackSeconds` (the elapsed time) when that is known.
 * The timeline is picked evenly by record, so an ordinary gap is the record
 * interval times the pick step and a pause stands out as one long jump. Falls
 * back to `fallbackSeconds` when there are too few points to tell.
 */
export const estimateRecordingSeconds = (
  points: ActivityPoint[],
  fallbackSeconds: number
): number => {
  const gaps: number[] = []
  for (let index = 1; index < points.length; index += 1) {
    const gap = points[index].elapsedSeconds - points[index - 1].elapsedSeconds
    if (gap > 0) gaps.push(gap)
  }
  const usual = median(gaps)
  if (gaps.length < 2 || usual === null) return fallbackSeconds
  const pauseAbove = Math.max(usual * 4, usual + 10)
  // Each point stands for one usual gap, the last one included, and running
  // time never exceeds the elapsed time it is part of.
  const running =
    gaps.reduce((sum, gap) => sum + (gap > pauseAbove ? usual : gap), 0) + usual
  return fallbackSeconds > 0 ? Math.min(running, fallbackSeconds) : running
}

/** A pause cut out of the chart's time axis, in elapsed and in chart time. */
export interface ChartPause {
  startSeconds: number
  endSeconds: number
  chartStartSeconds: number
  chartEndSeconds: number
}

/**
 * The Analysis chart's time axis: elapsed time with each pause (an auto-pause
 * or a stop, found as in `estimateRecordingSeconds`) shortened to one usual
 * gap, so the lines run on across it instead of breaking, as on Strava. Laps,
 * climbs, the crosshair and the map marker convert through
 * `toChartSeconds` / `toElapsedSeconds`, so they stay on the same instant.
 */
export interface ChartTimeAxis {
  /** The chart's length: the elapsed duration less the paused time. */
  durationSeconds: number
  pauses: ChartPause[]
}

export const buildChartTimeAxis = (
  points: ActivityPoint[],
  durationSeconds: number
): ChartTimeAxis => {
  const gaps: number[] = []
  for (let index = 1; index < points.length; index += 1) {
    const gap = points[index].elapsedSeconds - points[index - 1].elapsedSeconds
    if (gap > 0) gaps.push(gap)
  }
  const usual = median(gaps)
  if (gaps.length < 2 || usual === null) return { durationSeconds, pauses: [] }
  const pauseAbove = Math.max(usual * 4, usual + 10)
  const pauses: ChartPause[] = []
  let removed = 0
  for (let index = 1; index < points.length; index += 1) {
    const startSeconds = points[index - 1].elapsedSeconds
    const endSeconds = points[index].elapsedSeconds
    if (endSeconds - startSeconds <= pauseAbove) continue
    const chartStartSeconds = startSeconds - removed
    pauses.push({
      startSeconds,
      endSeconds,
      chartStartSeconds,
      chartEndSeconds: chartStartSeconds + usual
    })
    removed += endSeconds - startSeconds - usual
  }
  return { durationSeconds: Math.max(0, durationSeconds - removed), pauses }
}

// Converts between the two clocks: inside a pause the one clock is scaled onto
// the other's span, and past it they differ by the time cut so far.
const convertTime = (
  pauses: ChartPause[],
  seconds: number,
  from: 'elapsed' | 'chart'
): number => {
  let offset = 0
  for (const pause of pauses) {
    const [fromStart, fromEnd, toStart, toEnd] =
      from === 'elapsed'
        ? [
            pause.startSeconds,
            pause.endSeconds,
            pause.chartStartSeconds,
            pause.chartEndSeconds
          ]
        : [
            pause.chartStartSeconds,
            pause.chartEndSeconds,
            pause.startSeconds,
            pause.endSeconds
          ]
    if (seconds <= fromStart) break
    if (seconds < fromEnd) {
      return (
        toStart +
        ((seconds - fromStart) / (fromEnd - fromStart)) * (toEnd - toStart)
      )
    }
    offset = toEnd - fromEnd
  }
  return seconds + offset
}

/** Where an elapsed time sits on the chart's time axis. */
export const toChartSeconds = (axis: ChartTimeAxis, elapsedSeconds: number) =>
  convertTime(axis.pauses, elapsedSeconds, 'elapsed')

/** The elapsed time at a point on the chart's time axis. */
export const toElapsedSeconds = (axis: ChartTimeAxis, chartSeconds: number) =>
  convertTime(axis.pauses, chartSeconds, 'chart')

const bestAverage = (prefix: number[], windowSize: number): number | null => {
  const count = prefix.length - 1
  if (windowSize < 1 || windowSize > count) return null
  let best = -Infinity
  for (let end = windowSize; end <= count; end += 1) {
    const sum = prefix[end] - prefix[end - windowSize]
    if (sum > best) best = sum
  }
  return best / windowSize
}

const prefixSums = (series: number[]) => {
  const prefix = new Array<number>(series.length + 1)
  prefix[0] = 0
  for (let index = 0; index < series.length; index += 1) {
    prefix[index + 1] = prefix[index] + series[index]
  }
  return prefix
}

export const average = (values: number[]): number | null =>
  values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length

/**
 * Normalized power: the fourth-power mean of the 30-second rolling average,
 * raised back to the fourth root. Null for a ride shorter than one window.
 */
export const computeNormalizedPower = (
  power: number[],
  sampleSeconds = 1
): number | null => {
  const windowSize = Math.max(1, Math.round(30 / sampleSeconds))
  if (power.length < windowSize) return null
  const prefix = prefixSums(power)
  let sumOfFourthPowers = 0
  let windows = 0
  for (let end = windowSize; end <= power.length; end += 1) {
    const rolling = (prefix[end] - prefix[end - windowSize]) / windowSize
    sumOfFourthPowers += rolling ** 4
    windows += 1
  }
  return Math.round((sumOfFourthPowers / windows) ** 0.25)
}

export interface PowerEffort {
  durationSeconds: number
  watts: number
}

/** The durations the Best efforts strip shows. */
export const BEST_EFFORT_DURATIONS = [5, 60, 300, 1200, 3600]

/** The durations the power curve is plotted at (a log scale, 1 s to 4 h). */
export const POWER_CURVE_DURATIONS = [
  1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 420, 600, 900,
  1200, 1800, 2700, 3600, 5400, 7200, 10800, 14400
]

/**
 * The highest average power held for each duration. A duration longer than
 * the recording is left out rather than reported as the whole-ride average.
 */
export const computeBestEfforts = (
  power: number[],
  sampleSeconds = 1,
  durations: number[] = BEST_EFFORT_DURATIONS
): PowerEffort[] => {
  if (power.length === 0) return []
  const prefix = prefixSums(power)
  return durations.flatMap((durationSeconds) => {
    const windowSize = Math.max(1, Math.round(durationSeconds / sampleSeconds))
    const best = bestAverage(prefix, windowSize)
    return best === null ? [] : [{ durationSeconds, watts: Math.round(best) }]
  })
}

export const computePowerCurve = (
  power: number[],
  sampleSeconds = 1
): PowerEffort[] =>
  computeBestEfforts(power, sampleSeconds, POWER_CURVE_DURATIONS)

export const computeTimeAtZeroPowerSeconds = (
  power: number[],
  sampleSeconds = 1
): number => power.filter((watts) => watts <= 0).length * sampleSeconds

/**
 * Average left/right balance while pedalling, as whole percents that add up to
 * 100. Coasting points are left out: with no force there is no split.
 */
export const computeLeftRightBalance = (
  points: ActivityPoint[]
): { left: number; right: number } | null => {
  const values = points
    .filter(
      (point) =>
        isFiniteNumber(point.leftRightBalance) &&
        (!isFiniteNumber(point.power) || point.power > 0)
    )
    .map((point) => point.leftRightBalance as number)
  const mean = average(values)
  if (mean === null) return null
  const left = Math.round(mean)
  return { left, right: 100 - left }
}

/** Fewer points than this in either half gives no decoupling figure. */
const DECOUPLING_MIN_POINTS = 10

/**
 * Aerobic decoupling (Pa:HR): how much the power produced per heartbeat fell
 * from the first half of the activity to the second, in percent. Positive
 * means the heart worked harder for the same power later on.
 */
export const computeDecouplingPercent = (
  points: ActivityPoint[]
): number | null => {
  const paired = points.filter(
    (point) => isFiniteNumber(point.power) && isFiniteNumber(point.heartRate)
  )
  if (paired.length < DECOUPLING_MIN_POINTS * 2) return null
  const start = paired[0].elapsedSeconds
  const end = paired[paired.length - 1].elapsedSeconds
  const middle = (start + end) / 2
  const firstHalf = paired.filter((point) => point.elapsedSeconds < middle)
  const secondHalf = paired.filter((point) => point.elapsedSeconds >= middle)
  if (
    firstHalf.length < DECOUPLING_MIN_POINTS ||
    secondHalf.length < DECOUPLING_MIN_POINTS
  ) {
    return null
  }
  const ratio = (half: ActivityPoint[]) => {
    const power = average(half.map((point) => point.power as number)) ?? 0
    const heartRate =
      average(half.map((point) => point.heartRate as number)) ?? 0
    return heartRate > 0 ? power / heartRate : 0
  }
  const first = ratio(firstHalf)
  if (first <= 0) return null
  return ((first - ratio(secondHalf)) / first) * 100
}

/**
 * Centered moving average over `radius` points either side. The window
 * narrows symmetrically at the ends, so the first and last values are kept and
 * a profile's total rise is not shaved off at its edges.
 */
export const smoothValues = (values: number[], radius = 2): number[] =>
  values.map((_, index) => {
    const reach = Math.min(radius, index, values.length - 1 - index)
    const from = index - reach
    const to = index + reach
    let sum = 0
    for (let cursor = from; cursor <= to; cursor += 1) sum += values[cursor]
    return sum / (to - from + 1)
  })

/** Total ascent of an altitude profile: the sum of every rise. */
export const computeElevationGain = (altitudes: number[]): number => {
  const smoothed = smoothValues(altitudes)
  let gain = 0
  for (let index = 1; index < smoothed.length; index += 1) {
    const rise = smoothed[index] - smoothed[index - 1]
    if (rise > 0) gain += rise
  }
  return gain
}

export interface RangeSummary {
  distanceMeters: number | null
  avgPower: number | null
  avgHeartRate: number | null
  avgCadence: number | null
  gainMeters: number | null
}

/**
 * Averages over the timeline points inside a time range, for a lap the file
 * gives no aggregates for and for every climb. Power averages include zeros
 * (coasting is part of the effort); cadence leaves them out, as head units do.
 */
export const summarizeRange = (
  points: ActivityPoint[],
  { startSeconds, endSeconds }: TimeRange
): RangeSummary => {
  const inRange = points.filter(
    (point) =>
      point.elapsedSeconds >= startSeconds && point.elapsedSeconds <= endSeconds
  )
  const withDistance = inRange.filter((point) =>
    isFiniteNumber(point.distanceMeters)
  )
  const altitudes = inRange
    .map((point) => point.altitude)
    .filter(isFiniteNumber)
  return {
    distanceMeters:
      withDistance.length >= 2
        ? (withDistance[withDistance.length - 1].distanceMeters as number) -
          (withDistance[0].distanceMeters as number)
        : null,
    avgPower: average(
      inRange.map((point) => point.power).filter(isFiniteNumber)
    ),
    avgHeartRate: average(
      inRange.map((point) => point.heartRate).filter(isFiniteNumber)
    ),
    avgCadence: average(
      inRange
        .map((point) => point.cadence)
        .filter((value): value is number => isFiniteNumber(value) && value > 0)
    ),
    gainMeters: altitudes.length >= 2 ? computeElevationGain(altitudes) : null
  }
}

export interface ActivitySplit extends TimeRange {
  key: string
  label: string
  /** The muted line under the name: "0.0 – 5.0 km", "from km 10.8". */
  subline: string | null
  durationSeconds: number
  distanceMeters: number | null
  avgSpeedKmh: number | null
  avgPower: number | null
  avgHeartRate: number | null
  avgCadence: number | null
  gainMeters: number | null
  /** Gain over distance, in percent. */
  gradePercent: number | null
}

const formatKm = (meters: number) => (meters / 1000).toFixed(1)

const toGrade = (gain: number | null, distance: number | null) =>
  gain !== null && distance !== null && distance > 0
    ? (gain / distance) * 100
    : null

/**
 * Where the file's first record sits on the clock, in epoch ms, read off any
 * timeline point that has both a timestamp and its elapsed time.
 */
const getFileStartMs = (points: ActivityPoint[]): number | null => {
  const anchor = points.find((point) => isFiniteNumber(point.timestamp))
  return anchor
    ? (anchor.timestamp as number) - anchor.elapsedSeconds * 1000
    : null
}

/**
 * Laps as time ranges on the timeline, with each column the table shows. The
 * file's own lap aggregates win; a lap that has none is averaged from the
 * timeline. A lap runs until the next lap starts (the last one for its own
 * duration), so the lap band covers the activity without gaps even where a
 * TCX lap's duration is timer time and leaves out a pause.
 */
export const buildLapSplits = (
  laps: FitnessRouteLap[],
  points: ActivityPoint[],
  {
    totalDurationSeconds,
    cadenceMultiplier = 1
  }: { totalDurationSeconds: number; cadenceMultiplier?: number }
): ActivitySplit[] => {
  if (laps.length === 0) return []
  const fileStartMs = getFileStartMs(points)
  const starts = laps.map((lap) =>
    isFiniteNumber(lap.startTimestamp) && fileStartMs !== null
      ? Math.max(0, (lap.startTimestamp - fileStartMs) / 1000)
      : lap.startElapsedSeconds
  )

  let distanceSoFar = 0
  return laps.map((lap, index) => {
    const startSeconds = starts[index]
    const ownEnd = startSeconds + lap.durationSeconds
    const nextStart = starts[index + 1]
    const endSeconds =
      isFiniteNumber(nextStart) && nextStart > startSeconds
        ? nextStart
        : totalDurationSeconds > startSeconds
          ? Math.min(ownEnd, totalDurationSeconds)
          : ownEnd
    const summary = summarizeRange(points, { startSeconds, endSeconds })
    const distanceMeters =
      lap.distanceMeters > 0 ? lap.distanceMeters : summary.distanceMeters
    const subline =
      distanceMeters !== null
        ? `${formatKm(distanceSoFar)} – ${formatKm(distanceSoFar + distanceMeters)} km`
        : null
    distanceSoFar += distanceMeters ?? 0
    const gainMeters = isFiniteNumber(lap.elevationGainMeters)
      ? lap.elevationGainMeters
      : summary.gainMeters
    const avgSpeedKmh = isFiniteNumber(lap.avgSpeed)
      ? lap.avgSpeed
      : distanceMeters !== null && lap.durationSeconds > 0
        ? (distanceMeters / lap.durationSeconds) * 3.6
        : null
    return {
      key: `lap-${index + 1}`,
      label: `Lap ${index + 1}`,
      subline,
      startSeconds,
      endSeconds,
      durationSeconds: lap.durationSeconds,
      distanceMeters,
      avgSpeedKmh,
      avgPower: isFiniteNumber(lap.avgPower) ? lap.avgPower : summary.avgPower,
      avgHeartRate: isFiniteNumber(lap.avgHeartRate)
        ? lap.avgHeartRate
        : summary.avgHeartRate,
      // The file's lap cadence is raw (one foot for a run); the timeline's is
      // already converted.
      avgCadence: isFiniteNumber(lap.avgCadence)
        ? lap.avgCadence * cadenceMultiplier
        : summary.avgCadence,
      gainMeters,
      gradePercent: toGrade(gainMeters, distanceMeters)
    }
  })
}

/**
 * Climb detection thresholds. A climb is a stretch from a low point to the
 * highest point reached before the road gives back {@link CLIMB_END_DROP_METERS}
 * or runs flat for {@link CLIMB_END_PLATEAU_METERS}, trimmed at both ends (see
 * {@link CLIMB_EDGE_GRADE_PERCENT}), and it is kept only when
 * it gains at least {@link CLIMB_MIN_GAIN_METERS} over at least
 * {@link CLIMB_MIN_LENGTH_METERS} at an average of at least
 * {@link CLIMB_MIN_GRADE_PERCENT}. Altitude is smoothed over five points
 * first, so altimeter jitter neither starts nor ends a climb.
 */
export const CLIMB_MIN_GAIN_METERS = 20
export const CLIMB_MIN_LENGTH_METERS = 300
export const CLIMB_MIN_GRADE_PERCENT = 1
export const CLIMB_END_DROP_METERS = 10
export const CLIMB_END_PLATEAU_METERS = 1000
/**
 * Each end of a climb is trimmed while the 200 m beyond it rises by less than
 * 2%, so a long, almost flat approach or top is not counted as climbing.
 */
export const CLIMB_EDGE_WINDOW_METERS = 200
export const CLIMB_EDGE_GRADE_PERCENT = 2

export interface DetectedClimb extends TimeRange {
  startDistanceMeters: number
  lengthMeters: number
  gainMeters: number
}

export const detectClimbs = (points: ActivityPoint[]): DetectedClimb[] => {
  const usable = points.filter(
    (point) =>
      isFiniteNumber(point.altitude) && isFiniteNumber(point.distanceMeters)
  )
  if (usable.length < 3) return []
  const altitude = smoothValues(usable.map((point) => point.altitude as number))
  const distance = usable.map((point) => point.distanceMeters as number)
  const climbs: DetectedClimb[] = []

  // The rise over the next (or previous) 200 m, in percent.
  const gradeAhead = (from: number, limit: number) => {
    let to = from
    while (
      to < limit &&
      distance[to] - distance[from] < CLIMB_EDGE_WINDOW_METERS
    ) {
      to += 1
    }
    const run = distance[to] - distance[from]
    return run > 0 ? ((altitude[to] - altitude[from]) / run) * 100 : 0
  }
  const gradeBehind = (to: number, limit: number) => {
    let from = to
    while (
      from > limit &&
      distance[to] - distance[from] < CLIMB_EDGE_WINDOW_METERS
    ) {
      from -= 1
    }
    const run = distance[to] - distance[from]
    return run > 0 ? ((altitude[to] - altitude[from]) / run) * 100 : 0
  }

  const consider = (fromLow: number, toPeak: number) => {
    if (toPeak <= fromLow) return
    // Trim the gentle approach and the flat top: a road that rises 2 m over
    // 4 km before the real climb would otherwise drag its average grade under
    // the threshold and hide the climb.
    let low = fromLow
    let peak = toPeak
    while (low < peak && gradeAhead(low, peak) < CLIMB_EDGE_GRADE_PERCENT) {
      low += 1
    }
    while (peak > low && gradeBehind(peak, low) < CLIMB_EDGE_GRADE_PERCENT) {
      peak -= 1
    }
    if (peak <= low) return
    const gainMeters = altitude[peak] - altitude[low]
    const lengthMeters = distance[peak] - distance[low]
    if (
      gainMeters < CLIMB_MIN_GAIN_METERS ||
      lengthMeters < CLIMB_MIN_LENGTH_METERS ||
      (gainMeters / lengthMeters) * 100 < CLIMB_MIN_GRADE_PERCENT
    ) {
      return
    }
    climbs.push({
      startSeconds: usable[low].elapsedSeconds,
      endSeconds: usable[peak].elapsedSeconds,
      startDistanceMeters: distance[low],
      lengthMeters,
      gainMeters
    })
  }

  let low = 0
  let peak = 0
  let trough = 0
  for (let index = 1; index < usable.length; index += 1) {
    const value = altitude[index]
    if (value < altitude[low] || (peak === low && value === altitude[low])) {
      // Lower than where the climb started: whatever came before was a bump.
      // On the flat before a climb the start keeps moving to the last point.
      consider(low, peak)
      low = index
      peak = index
      trough = index
      continue
    }
    if (value > altitude[peak]) {
      peak = index
      trough = index
      continue
    }
    if (value < altitude[trough]) trough = index
    const dropped = altitude[peak] - altitude[trough] >= CLIMB_END_DROP_METERS
    const plateau = distance[index] - distance[peak] >= CLIMB_END_PLATEAU_METERS
    if (dropped || plateau) {
      consider(low, peak)
      // The next climb starts from the lowest point since this one's top.
      low = trough
      peak = trough
      for (let cursor = trough + 1; cursor <= index; cursor += 1) {
        if (altitude[cursor] > altitude[peak]) peak = cursor
      }
      trough = peak
      for (let cursor = peak + 1; cursor <= index; cursor += 1) {
        if (altitude[cursor] < altitude[trough]) trough = cursor
      }
    }
  }
  consider(low, peak)
  return climbs
}

export const buildClimbSplits = (
  climbs: DetectedClimb[],
  points: ActivityPoint[]
): ActivitySplit[] =>
  climbs.map((climb, index) => {
    const summary = summarizeRange(points, climb)
    const durationSeconds = climb.endSeconds - climb.startSeconds
    return {
      key: `climb-${index + 1}`,
      label: `Climb ${index + 1}`,
      subline: `from km ${formatKm(climb.startDistanceMeters)}`,
      startSeconds: climb.startSeconds,
      endSeconds: climb.endSeconds,
      durationSeconds,
      distanceMeters: climb.lengthMeters,
      avgSpeedKmh:
        durationSeconds > 0
          ? (climb.lengthMeters / durationSeconds) * 3.6
          : null,
      avgPower: summary.avgPower,
      avgHeartRate: summary.avgHeartRate,
      avgCadence: summary.avgCadence,
      gainMeters: climb.gainMeters,
      gradePercent: toGrade(climb.gainMeters, climb.lengthMeters)
    }
  })

/**
 * "6 × 5 km" when every lap but the last covers the same distance (to 0.1 km)
 * and the last is no longer, the way an auto lap reads; otherwise just the
 * count.
 */
export const formatLapPattern = (laps: ActivitySplit[]): string | null => {
  if (laps.length === 0) return null
  const distances = laps.map((lap) =>
    lap.distanceMeters === null
      ? null
      : Math.round(lap.distanceMeters / 100) / 10
  )
  const full = distances.slice(0, -1)
  const last = distances[distances.length - 1]
  const first = full[0]
  if (
    laps.length >= 2 &&
    first !== null &&
    first !== undefined &&
    first > 0 &&
    full.every((distance) => distance === first) &&
    last !== null &&
    last <= first
  ) {
    return `${laps.length} × ${Number.isInteger(first) ? first : first.toFixed(1)} km`
  }
  return `${laps.length}`
}

export interface PowerDistributionBin {
  /** Lower edge of the 25 W bucket. */
  fromWatts: number
  minutes: number
}

export interface PowerDistribution {
  bins: PowerDistributionBin[]
  /** The last bin holds everything from its lower edge up ("400+"). */
  isLastOpenEnded: boolean
}

/** Share of pedalling time the distribution shows before it folds the tail. */
export const POWER_DISTRIBUTION_COVERAGE = 0.99

/**
 * Time spent in each 25 W bucket while pedalling. The 0–25 W bucket is left
 * out (it is coasting, and dwarfs every other bar), and the sparse top end is
 * folded into one open-ended bucket once 99% of the time is covered, so a
 * single sprint does not squeeze the chart into its left third.
 */
export const buildPowerDistribution = (
  power: number[],
  sampleSeconds = 1
): PowerDistribution => {
  const minutes = computePowerHistogramMinutes(power)
    .map((value, index) => ({
      fromWatts: index * 25,
      minutes: value * sampleSeconds
    }))
    .slice(1)
  const total = minutes.reduce((sum, bin) => sum + bin.minutes, 0)
  if (total <= 0) return { bins: [], isLastOpenEnded: false }

  let cumulative = 0
  let cutoff = minutes.length - 1
  for (let index = 0; index < minutes.length; index += 1) {
    cumulative += minutes[index].minutes
    if (cumulative / total >= POWER_DISTRIBUTION_COVERAGE) {
      cutoff = index
      break
    }
  }
  // Trim trailing empty buckets, then fold what is left past the cutoff.
  let lastNonEmpty = minutes.length - 1
  while (lastNonEmpty > 0 && minutes[lastNonEmpty].minutes === 0) {
    lastNonEmpty -= 1
  }
  if (cutoff >= lastNonEmpty) {
    return { bins: minutes.slice(0, lastNonEmpty + 1), isLastOpenEnded: false }
  }
  const head = minutes.slice(0, cutoff + 1)
  const tail = minutes
    .slice(cutoff + 1)
    .reduce((sum, bin) => sum + bin.minutes, 0)
  head[head.length - 1] = {
    ...head[head.length - 1],
    minutes: head[head.length - 1].minutes + tail
  }
  return { bins: head, isLastOpenEnded: true }
}
