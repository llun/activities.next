import { formatFitnessDuration } from '@/lib/utils/fitness'

/**
 * How densely a chart series is plotted, as samples-per-drawn-point.
 * Matches Strava's 8:1 ratio (e.g. 5,913 samples -> 740 drawn; 5,272 -> 659).
 */
export const ANALYSIS_SAMPLES_PER_POINT = 8

/**
 * Floors and ceilings on drawn point count.
 * The floor keeps a short activity at least as detailed as it was before (120 points).
 * The ceiling bounds the path strings for long recordings (1,200 points).
 */
export const ANALYSIS_SERIES_MIN_POINTS = 120
export const ANALYSIS_SERIES_MAX_POINTS = 1_200

/**
 * Default tick counts for time axes across charts.
 * 6 ticks for full analysis panels; 4 ticks for the narrower overview elevation card.
 */
export const DEFAULT_TICK_COUNT = 6
export const OVERVIEW_TICK_COUNT = 4

/**
 * Common graph view heights.
 */
export const GRAPH_VIEW_HEIGHT = 250
export const OVERVIEW_GRAPH_VIEW_HEIGHT = 130

/**
 * Fraction of plot width beyond which the hover value chip flips to the left
 * of the cursor to avoid overflowing container padding.
 */
export const CHART_READOUT_FLIP_THRESHOLD = 0.62

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

/**
 * Reduce one raw series to the point count Strava would draw it at.
 * An empty series stays empty.
 */
export const plotAtStravaDensity = (series: number[]): number[] => {
  if (series.length === 0) return []
  return downsampleSeries(
    series,
    clampNumber(
      Math.round(series.length / ANALYSIS_SAMPLES_PER_POINT),
      ANALYSIS_SERIES_MIN_POINTS,
      ANALYSIS_SERIES_MAX_POINTS
    )
  )
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

/**
 * Builds SVG line path (`M x y L x y ...`) for a series of values.
 */
export const buildChartPath = (
  values: number[],
  width: number,
  height: number,
  minValue?: number,
  maxValue?: number
): string => {
  if (values.length === 0) return ''

  const defaultMinMax = getSeriesMinMax(values)
  const min = typeof minValue === 'number' ? minValue : defaultMinMax.minValue
  const max = typeof maxValue === 'number' ? maxValue : defaultMinMax.maxValue

  return values
    .map((value, index) => {
      const x = getChartXPosition(index, values.length, width)
      const y = getChartYPosition(value, height, min, max)
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

/**
 * Closes an SVG line path into an area path spanning down to the bottom (height).
 */
export const buildChartAreaPath = (
  linePath: string,
  width: number,
  height: number
): string => {
  if (!linePath) return ''
  return `${linePath} L ${width.toFixed(2)} ${height} L 0 ${height} Z`
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

export interface ScaledSeriesInput<TKey extends string = string> {
  key: TKey
  label?: string
  unit?: string
  values: number[]
  fractionDigits?: number
}

export interface PlottedCombinedSeries<TKey extends string = string> {
  key: TKey
  label: string
  unit: string
  values: number[]
  fractionDigits: number
  minValue: number
  maxValue: number
  path: string
}

/**
 * Scales multiple series independently to their own min and max values,
 * generating SVG path data for each.
 */
export const scaleCombinedChartSeries = <T extends { values: number[] }>(
  seriesList: T[],
  width: number,
  height: number
): Array<T & { minValue: number; maxValue: number; path: string }> => {
  return seriesList.map((entry) => {
    const { minValue, maxValue } = getSeriesMinMax(entry.values)
    return {
      ...entry,
      minValue,
      maxValue,
      path: buildChartPath(entry.values, width, height, minValue, maxValue)
    }
  })
}

export interface CombinedChartHighlight<TKey extends string = string> {
  key: TKey
  unit: string
  fractionDigits: number
  value: number
  x: number
  y: number
}

/**
 * Computes hover coordinates and values across multiple combined series for a given scrub ratio.
 */
export const computeCombinedChartHighlights = <TKey extends string = string>(
  plottedSeries: Array<{
    key: TKey
    unit: string
    fractionDigits: number
    values: number[]
    minValue: number
    maxValue: number
  }>,
  ratio: number | null,
  width: number,
  height: number
): Array<CombinedChartHighlight<TKey>> => {
  if (ratio === null) return []
  return plottedSeries
    .map((entry) => {
      if (entry.values.length === 0) return null
      const index = clampNumber(
        Math.round(ratio * (entry.values.length - 1)),
        0,
        entry.values.length - 1
      )
      return {
        key: entry.key,
        unit: entry.unit,
        fractionDigits: entry.fractionDigits,
        value: entry.values[index],
        x: getChartXPosition(index, entry.values.length, width),
        y: getChartYPosition(
          entry.values[index],
          height,
          entry.minValue,
          entry.maxValue
        )
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
}

export interface ChartHighlight {
  value: number
  x: number
  y: number
}

/**
 * Computes sample index from highlighted elapsed seconds and total duration.
 */
export const computeHighlightedIndex = (
  highlightedElapsedSeconds: number | null | undefined,
  durationSeconds: number | undefined,
  pointCount: number
): number | null => {
  if (
    typeof highlightedElapsedSeconds !== 'number' ||
    typeof durationSeconds !== 'number' ||
    durationSeconds <= 0 ||
    pointCount <= 0
  ) {
    return null
  }
  return clampNumber(
    Math.round(
      (highlightedElapsedSeconds / durationSeconds) * (pointCount - 1)
    ),
    0,
    pointCount - 1
  )
}

/**
 * Computes plot highlight coordinates (x, y, value) for a single series.
 */
export const computeChartHighlight = (
  values: number[],
  highlightedIndex: number | null,
  width: number,
  height: number,
  minValue: number,
  maxValue: number
): ChartHighlight | null => {
  if (
    highlightedIndex === null ||
    highlightedIndex < 0 ||
    highlightedIndex >= values.length
  ) {
    return null
  }
  return {
    value: values[highlightedIndex],
    x: getChartXPosition(highlightedIndex, values.length, width),
    y: getChartYPosition(values[highlightedIndex], height, minValue, maxValue)
  }
}

/**
 * Checks whether the hover readout chip should flip to the left of the cursor.
 */
export const shouldFlipChartReadout = (
  x: number,
  width: number,
  threshold = CHART_READOUT_FLIP_THRESHOLD
): boolean => {
  if (width <= 0) return false
  return x / width > threshold
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
