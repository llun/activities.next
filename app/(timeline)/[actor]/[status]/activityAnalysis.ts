import type { FitnessRouteDataResponse } from '@/lib/client/fitnessRoutes'
import type { AnalysisSeriesKey } from '@/lib/components/fitness/palette'

import {
  type ActivityPoint,
  type ActivitySplit,
  type PowerDistribution,
  type PowerEffort,
  type SeriesScale,
  average,
  binValuesByTime,
  buildActivityTimeline,
  buildClimbSplits,
  buildLapSplits,
  buildPowerDistribution,
  computeBestEfforts,
  computeDecouplingPercent,
  computeGradeSeries,
  computeLeftRightBalance,
  computeNormalizedPower,
  computePowerCurve,
  computeTimeAtZeroPowerSeconds,
  detectClimbs,
  estimateSampleSeconds,
  getCadenceMultiplier,
  getSeriesScale,
  isRunActivity,
  spreadSeriesOverBins
} from './fitnessActivityMetrics'
import {
  type HeartRateStats,
  type HeartRateZone,
  computeHeartRateStats,
  computeHeartRateZones,
  fillHeartRateDropouts,
  filterPositiveHeartRateSeries,
  getSeriesMinMax
} from './fitnessChartData'

export interface AnalysisSeries {
  key: AnalysisSeriesKey
  label: string
  unit: string
  fractionDigits: number
  /** One value per time bin, null where nothing was recorded. */
  values: Array<number | null>
  scale: SeriesScale
}

export interface ActivityAnalysis {
  timeline: ActivityPoint[]
  durationSeconds: number
  /** How many equal slices of elapsed time the chart series are binned into. */
  binCount: number
  series: AnalysisSeries[]
  powerSeries: number[]
  sampleSeconds: number
  normalizedPower: number | null
  bestEfforts: PowerEffort[]
  powerCurve: PowerEffort[]
  powerDistribution: PowerDistribution
  timeAtZeroPowerSeconds: number | null
  leftRightBalance: { left: number; right: number } | null
  decouplingPercent: number | null
  heartRateStats: HeartRateStats | null
  heartRateZones: HeartRateZone[]
  maxSpeedKmh: number | null
  avgCadence: number | null
  cadenceUnit: 'rpm' | 'spm'
  temperature: { min: number; max: number; avg: number } | null
  calories: number | null
  laps: ActivitySplit[]
  climbs: ActivitySplit[]
}

/** Bins per chart: one per 5 s of the activity, between 60 and 600. */
export const getChartBinCount = (durationSeconds: number): number =>
  Math.max(60, Math.min(600, Math.round(durationSeconds / 5)))

const pick = <K extends keyof ActivityPoint>(
  points: ActivityPoint[],
  key: K
): Array<ActivityPoint[K]> => points.map((point) => point[key])

const hasAny = (values: Array<number | null | undefined>) =>
  values.some((value) => typeof value === 'number')

/**
 * Everything the activity page's sections show, derived once from the route
 * data. Chart series come from the timeline (so every series shares one time
 * axis), falling back to a full-resolution series spread over the activity
 * for a metric the timeline lacks. Power maths reads the full-resolution power
 * series; laps, climbs and decoupling read the timeline.
 */
export const deriveActivityAnalysis = ({
  data,
  activityType,
  fallbackDurationSeconds = 0
}: {
  data: FitnessRouteDataResponse
  activityType?: string | null
  fallbackDurationSeconds?: number
}): ActivityAnalysis => {
  const cadenceMultiplier = getCadenceMultiplier(activityType)
  const timeline = buildActivityTimeline({
    samples: data.samples ?? [],
    metricSamples: data.metricSamples,
    cadenceMultiplier
  })
  const lastElapsed = timeline[timeline.length - 1]?.elapsedSeconds ?? 0
  const durationSeconds =
    data.totalDurationSeconds > 0
      ? Math.max(data.totalDurationSeconds, lastElapsed)
      : Math.max(fallbackDurationSeconds, lastElapsed)
  const binCount = getChartBinCount(durationSeconds)

  const fromTimeline = (values: Array<number | null | undefined>) =>
    hasAny(values)
      ? binValuesByTime(timeline, values, durationSeconds, binCount)
      : []
  const withFallback = (
    binned: Array<number | null>,
    series: number[] | undefined
  ) =>
    binned.length > 0
      ? binned
      : series && series.length > 0
        ? spreadSeriesOverBins(series, binCount)
        : []

  const powerSeries = data.powerSeries ?? []
  const heartRateSeries = filterPositiveHeartRateSeries(
    data.heartRateSeries ?? []
  )
  const cadenceUnit = isRunActivity(activityType) ? 'spm' : 'rpm'

  const candidates: Array<Omit<AnalysisSeries, 'scale'>> = [
    {
      key: 'elevation',
      label: 'Elevation',
      unit: 'm',
      fractionDigits: 0,
      values: withFallback(
        fromTimeline(pick(timeline, 'altitude')),
        data.altitudeSeries
      )
    },
    {
      key: 'speed',
      label: 'Speed',
      unit: 'km/h',
      fractionDigits: 1,
      values: withFallback(
        fromTimeline(pick(timeline, 'speed')),
        data.speedSeries
      )
    },
    {
      key: 'power',
      label: 'Power',
      unit: 'W',
      fractionDigits: 0,
      values: withFallback(fromTimeline(pick(timeline, 'power')), powerSeries)
    },
    {
      key: 'heart-rate',
      label: 'Heart rate',
      unit: 'bpm',
      fractionDigits: 0,
      // Positionally aligned: a 0 bpm dropout holds the last reading rather
      // than being dropped, which would slide the rest of the series earlier.
      values: withFallback(
        fromTimeline(pick(timeline, 'heartRate')),
        fillHeartRateDropouts(data.heartRateSeries ?? [])
      )
    },
    {
      key: 'cadence',
      label: 'Cadence',
      unit: cadenceUnit,
      fractionDigits: 0,
      values: fromTimeline(pick(timeline, 'cadence'))
    },
    {
      key: 'temperature',
      label: 'Temperature',
      unit: '°C',
      fractionDigits: 0,
      values: fromTimeline(pick(timeline, 'temperature'))
    },
    {
      key: 'grade',
      label: 'Grade',
      unit: '%',
      fractionDigits: 1,
      values: fromTimeline(computeGradeSeries(timeline))
    }
  ]
  const series = candidates
    .filter((entry) => hasAny(entry.values))
    .map((entry) => ({
      ...entry,
      scale: getSeriesScale(entry.key, entry.values)
    }))

  const sampleSeconds = estimateSampleSeconds(
    powerSeries.length,
    durationSeconds
  )
  const hasPower = powerSeries.length > 0
  const speeds = (data.speedSeries ?? []).length
    ? (data.speedSeries as number[])
    : (pick(timeline, 'speed').filter(
        (value) => typeof value === 'number'
      ) as number[])
  const temperatures = pick(timeline, 'temperature').filter(
    (value): value is number => typeof value === 'number'
  )
  const cadences = pick(timeline, 'cadence').filter(
    (value): value is number => typeof value === 'number' && value > 0
  )
  const temperatureRange =
    temperatures.length > 0 ? getSeriesMinMax(temperatures) : null

  return {
    timeline,
    durationSeconds,
    binCount,
    series,
    powerSeries,
    sampleSeconds,
    normalizedPower: hasPower
      ? computeNormalizedPower(powerSeries, sampleSeconds)
      : null,
    bestEfforts: hasPower ? computeBestEfforts(powerSeries, sampleSeconds) : [],
    powerCurve: hasPower ? computePowerCurve(powerSeries, sampleSeconds) : [],
    powerDistribution: buildPowerDistribution(powerSeries, sampleSeconds),
    timeAtZeroPowerSeconds: hasPower
      ? computeTimeAtZeroPowerSeconds(powerSeries, sampleSeconds)
      : null,
    leftRightBalance: computeLeftRightBalance(timeline),
    decouplingPercent: computeDecouplingPercent(timeline),
    heartRateStats: computeHeartRateStats(heartRateSeries),
    heartRateZones:
      heartRateSeries.length > 0
        ? computeHeartRateZones(heartRateSeries, durationSeconds)
        : [],
    maxSpeedKmh: speeds.length > 0 ? getSeriesMinMax(speeds).maxValue : null,
    avgCadence: average(cadences),
    cadenceUnit,
    temperature:
      temperatureRange && temperatures.length > 0
        ? {
            min: temperatureRange.minValue,
            max: temperatureRange.maxValue,
            avg: average(temperatures) as number
          }
        : null,
    calories: typeof data.calories === 'number' ? data.calories : null,
    laps: buildLapSplits(data.laps ?? [], timeline, {
      totalDurationSeconds: durationSeconds,
      cadenceMultiplier
    }),
    climbs: buildClimbSplits(detectClimbs(timeline), timeline)
  }
}

/** The timeline point nearest an elapsed time (binary search). */
export const findPointAtElapsed = (
  points: ActivityPoint[],
  elapsedSeconds: number
): ActivityPoint | null => {
  if (points.length === 0) return null
  let low = 0
  let high = points.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (points[middle].elapsedSeconds < elapsedSeconds) low = middle + 1
    else high = middle
  }
  if (low === 0) return points[0]
  const before = points[low - 1]
  const after = points[low]
  return elapsedSeconds - before.elapsedSeconds <=
    after.elapsedSeconds - elapsedSeconds
    ? before
    : after
}
