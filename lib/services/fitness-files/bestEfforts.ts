import type { FitnessBestEffortValue } from '@/lib/database/domains/fitnessBestEffort/types'
import type { Database } from '@/lib/database/types'
import {
  computeBestEfforts,
  computeDistanceEfforts,
  estimateSampleSeconds,
  resolveRecordingSeconds
} from '@/lib/fitness/bestEfforts'
import { haversineDistanceMeters } from '@/lib/services/fitness-files/activityData'
import type {
  PreParsedMetricSample,
  PreParsedRouteDataPayload,
  PreParsedRouteSample
} from '@/lib/services/fitness-files/fileRouteDataCache'
import { isRunActivity } from '@/lib/services/fitness-files/sportTypes'

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const hasCoordinates = (
  sample: PreParsedRouteSample | PreParsedMetricSample
): sample is PreParsedRouteSample =>
  isFiniteNumber((sample as PreParsedRouteSample).lat) &&
  isFiniteNumber((sample as PreParsedRouteSample).lng)

/**
 * Elapsed time and cumulative distance per point, read the way the activity
 * page reads its timeline: the file's own distance where a point has it,
 * otherwise measured along the GPS track, or speed integrated over time with
 * no track. Every distance is null when none of that is possible.
 */
export const toEffortTimeline = (payload: PreParsedRouteDataPayload) => {
  const source: Array<PreParsedRouteSample | PreParsedMetricSample> =
    payload.routeSamples && payload.routeSamples.length > 0
      ? payload.routeSamples
      : (payload.metricSamples ?? [])
  const sorted = [...source].sort((a, b) => a.elapsedSeconds - b.elapsedSeconds)
  let distance = 0
  let hasDistance = false
  const points = sorted.map((sample, index) => {
    const previous = index > 0 ? sorted[index - 1] : null
    if (isFiniteNumber(sample.distanceMeters)) {
      distance = sample.distanceMeters
      hasDistance = true
    } else if (previous) {
      if (hasCoordinates(sample) && hasCoordinates(previous)) {
        distance += haversineDistanceMeters(previous, sample)
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
    return { elapsedSeconds: sample.elapsedSeconds, distanceMeters: distance }
  })
  return hasDistance
    ? points
    : points.map((point) => ({ ...point, distanceMeters: null }))
}

/**
 * Every best effort one activity holds: the best average power for each of
 * the activity page's durations, timed exactly as that page times them, and
 * for a run the fastest time over each record distance.
 */
export const computeFitnessBestEfforts = ({
  payload,
  activityType,
  movingTimeSeconds
}: {
  payload: PreParsedRouteDataPayload
  activityType: string | null | undefined
  movingTimeSeconds?: number | null
}): FitnessBestEffortValue[] => {
  const timeline = toEffortTimeline(payload)
  const efforts: FitnessBestEffortValue[] = []

  const power = payload.powerSeries ?? []
  if (power.length > 0) {
    const lastElapsed = timeline[timeline.length - 1]?.elapsedSeconds ?? 0
    const durationSeconds = Math.max(payload.totalDurationSeconds, lastElapsed)
    const sampleSeconds = estimateSampleSeconds(
      power.length,
      resolveRecordingSeconds({ timeline, durationSeconds, movingTimeSeconds })
    )
    for (const effort of computeBestEfforts(power, sampleSeconds)) {
      efforts.push({
        kind: 'power',
        key: effort.durationSeconds,
        value: effort.watts
      })
    }
  }

  if (isRunActivity(activityType)) {
    for (const effort of computeDistanceEfforts(timeline)) {
      efforts.push({
        kind: 'distance',
        key: effort.distanceMeters,
        value: effort.seconds
      })
    }
  }

  return efforts
}

/**
 * Computes one file's efforts and rewrites its stored rows, so a reprocess
 * replaces the previous run's numbers rather than adding to them.
 */
export const saveFitnessBestEfforts = async (
  database: Pick<Database, 'replaceFitnessBestEfforts'>,
  params: {
    fitnessFileId: string
    actorId: string
    statusId: string
    activityType: string | null | undefined
    activityDate: number
    movingTimeSeconds?: number | null
    payload: PreParsedRouteDataPayload
  }
): Promise<FitnessBestEffortValue[]> => {
  const efforts = computeFitnessBestEfforts(params)
  await database.replaceFitnessBestEfforts({
    fitnessFileId: params.fitnessFileId,
    actorId: params.actorId,
    statusId: params.statusId,
    activityType: params.activityType ?? null,
    activityDate: params.activityDate,
    efforts
  })
  return efforts
}
