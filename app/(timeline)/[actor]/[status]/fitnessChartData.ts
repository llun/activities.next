import { formatFitnessDuration } from '@/lib/utils/fitness'

/** Default tick count for a time axis. */
export const DEFAULT_TICK_COUNT = 6

export const clampNumber = (
  value: number,
  min: number,
  max: number
): number => {
  return Math.max(min, Math.min(max, value))
}

/**
 * Downsample an array of numbers to `targetCount` points using bin averaging.
 */
export const downsampleSeries = (
  series: number[],
  targetCount: number
): number[] => {
  if (series.length <= targetCount) return series
  if (targetCount <= 0) return []
  const ratio = series.length / targetCount
  const result: number[] = []
  for (let i = 0; i < targetCount; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.floor((i + 1) * ratio)
    const chunk = series.slice(start, end)
    const sum = chunk.reduce((a, b) => a + b, 0)
    result.push(chunk.length > 0 ? sum / chunk.length : 0)
  }
  return result
}

export interface SeriesMinMax {
  minValue: number
  maxValue: number
}

/**
 * Stack-safe computation of min and max across an array of numbers.
 * Avoids spreading large arrays into Math.min/Math.max.
 */
export const getSeriesMinMax = (values: number[]): SeriesMinMax => {
  if (values.length === 0) {
    return { minValue: 0, maxValue: 0 }
  }

  let minValue = values[0]
  let maxValue = values[0]

  for (let index = 1; index < values.length; index += 1) {
    if (values[index] < minValue) {
      minValue = values[index]
    } else if (values[index] > maxValue) {
      maxValue = values[index]
    }
  }

  return { minValue, maxValue }
}

/**
 * Value formatting helper that suppresses negative zero (`-0` or `-0.0`).
 * Adding 0 to `-0` evaluates to `+0`.
 */
export const formatChartValue = (
  value: number,
  fractionDigits: number
): string => {
  const formatted = value.toFixed(fractionDigits)
  return (Number(formatted) + 0).toFixed(fractionDigits)
}

/**
 * Format duration in seconds to M:SS or H:MM:SS, defaulting to '0:00'.
 */
export const formatDuration = (durationSeconds?: number): string =>
  formatFitnessDuration(durationSeconds, { fallback: '0:00' }) ?? '0:00'

/**
 * Generates evenly spaced time-axis tick labels across durationSeconds.
 */
export const buildXAxisLabels = (
  durationSeconds: number,
  tickCount = DEFAULT_TICK_COUNT
): string[] => {
  if (tickCount <= 0) return []
  if (tickCount === 1) return [formatDuration(0)]
  const labels: string[] = []
  for (let i = 0; i < tickCount; i++) {
    const ratio = i / (tickCount - 1)
    const seconds = Math.round(ratio * durationSeconds)
    labels.push(formatDuration(seconds))
  }
  return labels
}

export interface HeartRateZoneDefinition {
  name: string
  label: string
  lo: number
  hi: number | null
  color: string
}

export const HEART_RATE_ZONES: HeartRateZoneDefinition[] = [
  { name: 'Z1', label: 'Recovery', lo: 0, hi: 122, color: 'hsl(205 45% 62%)' },
  {
    name: 'Z2',
    label: 'Endurance',
    lo: 122,
    hi: 142,
    color: 'hsl(142 60% 45%)'
  },
  { name: 'Z3', label: 'Tempo', lo: 142, hi: 158, color: 'hsl(45 92% 50%)' },
  {
    name: 'Z4',
    label: 'Threshold',
    lo: 158,
    hi: 172,
    color: 'hsl(24 95% 50%)'
  },
  { name: 'Z5', label: 'Anaerobic', lo: 172, hi: null, color: 'hsl(2 78% 55%)' }
]

export interface HeartRateZone extends HeartRateZoneDefinition {
  seconds: number
  pct: number
  rawPct: number
}

/**
 * Buckets heart-rate samples into 5 standard training zones.
 * Excludes 0 bpm sensor dropouts from inflating Zone 1.
 */
export const computeHeartRateZones = (
  series: number[],
  durationSeconds: number
): HeartRateZone[] => {
  const counts = HEART_RATE_ZONES.map(() => 0)
  for (const bpm of series) {
    if (bpm <= 0) continue
    const index = HEART_RATE_ZONES.findIndex(
      (zone) => bpm >= zone.lo && (zone.hi === null || bpm < zone.hi)
    )
    if (index >= 0) counts[index] += 1
  }
  const totalSamples = counts.reduce((sum, value) => sum + value, 0)
  return HEART_RATE_ZONES.map((zone, index) => {
    const fraction = totalSamples > 0 ? counts[index] / totalSamples : 0
    return {
      ...zone,
      pct: Math.round(fraction * 100),
      rawPct: fraction * 100,
      seconds: Math.round(fraction * durationSeconds)
    }
  })
}

/**
 * Filter out sensor dropouts (<= 0 bpm) for tallies like avg, max, and zone buckets.
 */
export const filterPositiveHeartRateSeries = (series: number[]): number[] => {
  return series.filter((bpm) => bpm > 0)
}

/**
 * Hold the last good reading across a gap and back-fill leading dropouts.
 * Keeps series length and sample-index alignment with elapsed time,
 * while preventing 0 bpm dropouts from dipping the plotted line.
 */
export const fillHeartRateDropouts = (series: number[]): number[] => {
  const firstReading = series.find((bpm) => bpm > 0)
  if (firstReading === undefined) return []

  let lastReading = firstReading
  return series.map((bpm) => {
    if (bpm > 0) lastReading = bpm
    return lastReading
  })
}

export interface HeartRateStats {
  avg: number
  max: number
}

/**
 * Computes average and max heart rate, ignoring sensor dropouts (<= 0 bpm).
 */
export const computeHeartRateStats = (
  series: number[]
): HeartRateStats | null => {
  const positive = series.filter((bpm) => bpm > 0)
  if (positive.length === 0) return null
  const { maxValue } = getSeriesMinMax(positive)
  const avg = Math.round(positive.reduce((a, b) => a + b, 0) / positive.length)
  return { avg, max: Math.round(maxValue) }
}

/**
 * Computes 25-watt distribution histogram buckets in minutes.
 */
export const computePowerHistogramMinutes = (
  powerSeries: number[]
): number[] => {
  if (powerSeries.length === 0) return []
  const computedMaxPower = Math.max(getSeriesMinMax(powerSeries).maxValue, 100)
  const bucketCount = Math.ceil((computedMaxPower + 25) / 25)
  const buckets = new Array(bucketCount).fill(0)
  for (const p of powerSeries) {
    const bucketIndex = Math.floor(p / 25)
    if (bucketIndex >= 0 && bucketIndex < bucketCount) {
      buckets[bucketIndex] += 1
    }
  }
  return buckets.map((seconds) => seconds / 60)
}

/**
 * Projects sample index to SVG coordinate x.
 */
export const getChartXPosition = (
  index: number,
  count: number,
  width: number
): number => {
  return (index / Math.max(1, count - 1)) * width
}

/**
 * Projects sample value to SVG coordinate y.
 * Clamps flat ranges (maxValue === minValue) to avoid division by zero.
 */
export const getChartYPosition = (
  value: number,
  height: number,
  minValue: number,
  maxValue: number
): number => {
  const range = Math.max(1, maxValue - minValue)
  return height - ((value - minValue) / range) * height
}

export interface ChartPaths {
  line: string
  area: string
}

/**
 * The line and the filled area of a series that may have gaps (null values):
 * each unbroken run is its own subpath, and each closes down to the plot's
 * bottom on its own, so a pause in the recording is a gap in the chart rather
 * than a straight line drawn across it. Points sit at `index / (count - 1)`
 * of the width, the first on the left edge and the last on the right.
 */
export const buildGappedChartPaths = (
  values: Array<number | null>,
  minValue: number,
  maxValue: number,
  width: number,
  height: number
): ChartPaths => {
  const line: string[] = []
  const area: string[] = []
  let run: Array<[number, number]> = []
  const flush = () => {
    if (run.length === 0) return
    const points = run.length === 1 ? [run[0], run[0]] : run
    const subpath = points
      .map(
        ([x, y], index) =>
          `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
      )
      .join('')
    line.push(subpath)
    const first = points[0][0].toFixed(1)
    const last = points[points.length - 1][0].toFixed(1)
    area.push(`${subpath}L${last} ${height}L${first} ${height}Z`)
    run = []
  }
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      flush()
      return
    }
    run.push([
      getChartXPosition(index, values.length, width),
      clampNumber(
        getChartYPosition(value, height, minValue, maxValue),
        0,
        height
      )
    ])
  })
  flush()
  return { line: line.join(''), area: area.join('') }
}
