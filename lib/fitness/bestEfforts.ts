/**
 * Best efforts: the highest average power held for a set of durations, and the
 * fastest time a run covered a set of distances.
 *
 * Pure and dependency-free on purpose: the activity page computes them in the
 * browser from the route-data payload, and the fitness file processor computes
 * the same numbers on the server and stores them in `fitness_best_efforts`
 * for the Records page and the PR badge. One copy of the maths is what keeps
 * the page's figures and the stored records the same numbers.
 */

export interface PowerEffort {
  durationSeconds: number
  watts: number
}

export interface DistanceEffort {
  distanceMeters: number
  /** Elapsed seconds, to one decimal. */
  seconds: number
}

/** The durations the Best efforts strip shows. */
export const BEST_EFFORT_DURATIONS = [5, 60, 300, 1200, 3600]

/** 1 km, 5 km, 10 km, a half and a full marathon. */
export const RUN_EFFORT_DISTANCES = [1000, 5000, 10000, 21097.5, 42195]

export const median = (values: number[]): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
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
  points: ReadonlyArray<{ elapsedSeconds: number }>,
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

/**
 * How long the recorder was running, which the full-resolution series are
 * timed against: the larger of the file's moving time and the timeline's own
 * gaps with the pauses taken out, because a recorder that keeps writing
 * through stops (smart recording, about one record every 2 s) runs for longer
 * than the moving time, and reading its records against moving time alone
 * would take them for 1 Hz.
 */
export const resolveRecordingSeconds = ({
  timeline,
  durationSeconds,
  movingTimeSeconds
}: {
  timeline: ReadonlyArray<{ elapsedSeconds: number }>
  durationSeconds: number
  movingTimeSeconds?: number | null
}): number => {
  const movingSeconds =
    typeof movingTimeSeconds === 'number' && movingTimeSeconds > 0
      ? durationSeconds > 0
        ? Math.min(movingTimeSeconds, durationSeconds)
        : movingTimeSeconds
      : 0
  return Math.max(
    movingSeconds,
    estimateRecordingSeconds(timeline, durationSeconds)
  )
}

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

export const prefixSums = (series: number[]) => {
  const prefix = new Array<number>(series.length + 1)
  prefix[0] = 0
  for (let index = 0; index < series.length; index += 1) {
    prefix[index + 1] = prefix[index] + series[index]
  }
  return prefix
}

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

/**
 * The fastest elapsed time over each distance, from a time-ordered series of
 * cumulative distances. Two two-pointer passes over the series: one ends each
 * window on a recorded point and interpolates where it starts, the other
 * starts each window on a point and interpolates where it ends. Time is
 * linear between points, so the fastest window has one of its two ends on a
 * point, and the two passes between them find it exactly. A distance longer
 * than the activity is left out.
 */
export const computeDistanceEfforts = (
  points: ReadonlyArray<{
    elapsedSeconds: number
    distanceMeters: number | null | undefined
  }>,
  distances: number[] = RUN_EFFORT_DISTANCES
): DistanceEffort[] => {
  const times: number[] = []
  const meters: number[] = []
  for (const point of points) {
    const { elapsedSeconds, distanceMeters } = point
    if (!Number.isFinite(elapsedSeconds)) continue
    if (typeof distanceMeters !== 'number') continue
    if (!Number.isFinite(distanceMeters)) continue
    // A device that steps distance backwards is read as standing still.
    const previous = meters[meters.length - 1]
    times.push(elapsedSeconds)
    meters.push(
      previous === undefined
        ? distanceMeters
        : Math.max(previous, distanceMeters)
    )
  }
  const count = times.length
  if (count < 2) return []
  const covered = meters[count - 1] - meters[0]

  return distances.flatMap((distance) => {
    if (!(distance > 0) || distance > covered) return []
    let best = Infinity

    // Each window ends on point `end`; it starts between `start` and the next.
    let start = 0
    for (let end = 1; end < count; end += 1) {
      if (meters[end] - meters[0] < distance) continue
      while (meters[end] - meters[start + 1] >= distance) start += 1
      const target = meters[end] - distance
      const span = meters[start + 1] - meters[start]
      const startTime =
        span > 0
          ? times[start] +
            ((times[start + 1] - times[start]) * (target - meters[start])) /
              span
          : times[start]
      best = Math.min(best, times[end] - startTime)
    }

    // Each window starts on point `from`; it ends between `to - 1` and `to`.
    let to = 1
    for (let from = 0; from < count; from += 1) {
      const target = meters[from] + distance
      if (target > meters[count - 1]) break
      while (meters[to] < target) to += 1
      const span = meters[to] - meters[to - 1]
      const endTime =
        span > 0
          ? times[to - 1] +
            ((times[to] - times[to - 1]) * (target - meters[to - 1])) / span
          : times[to]
      best = Math.min(best, endTime - times[from])
    }

    return Number.isFinite(best)
      ? [{ distanceMeters: distance, seconds: Math.round(best * 10) / 10 }]
      : []
  })
}

/** What `GET /api/v1/fitness/records` covers: all time, this year, 90 days. */
export const FITNESS_RECORDS_RANGES = ['all', 'year', '90d'] as const
export type FitnessRecordsRange = (typeof FITNESS_RECORDS_RANGES)[number]

/** The activity that holds a record, as the Records page links it. */
export interface FitnessRecordActivity {
  statusId: string
  statusPath: string
  title: string
  /** The activity's start time, epoch milliseconds. */
  activityDate: number
}

/** One row of a records list; `value` and `activity` are null when unset. */
export interface FitnessRecordEntry {
  /** Seconds for power, metres for distance. */
  key: number
  /** Watts for power, elapsed seconds for distance. */
  value: number | null
  activity: FitnessRecordActivity | null
}

export interface FitnessRecords {
  range: FitnessRecordsRange
  power: FitnessRecordEntry[]
  distance: FitnessRecordEntry[]
}
