import { buildActivityTimeline } from '@/app/(timeline)/[actor]/[status]/fitnessActivityMetrics'
import type { PreParsedRouteDataPayload } from '@/lib/services/fitness-files/fileRouteDataCache'

import {
  computeFitnessBestEfforts,
  saveFitnessBestEfforts,
  toEffortTimeline
} from './bestEfforts'

// A 1 Hz metric-only payload: `seconds` samples at `metersPerSecond`.
const indoorPayload = (
  seconds: number,
  metersPerSecond: number,
  power?: number
): PreParsedRouteDataPayload => ({
  version: 1,
  totalDurationSeconds: seconds,
  metricSamples: Array.from({ length: seconds + 1 }, (_, index) => ({
    elapsedSeconds: index,
    distanceMeters: index * metersPerSecond
  })),
  ...(power ? { powerSeries: new Array(seconds).fill(power) } : {})
})

describe('computeFitnessBestEfforts', () => {
  it('stores the five power durations of an hour with power', () => {
    expect(
      computeFitnessBestEfforts({
        payload: indoorPayload(3600, 8, 210),
        activityType: 'ride'
      })
    ).toEqual(
      [5, 60, 300, 1200, 3600].map((key) => ({
        kind: 'power',
        key,
        value: 210
      }))
    )
  })

  it('stores run distances for a run, and none for a ride', () => {
    const payload = indoorPayload(1300, 4)
    expect(computeFitnessBestEfforts({ payload, activityType: 'run' })).toEqual(
      [
        { kind: 'distance', key: 1000, value: 250 },
        { kind: 'distance', key: 5000, value: 1250 }
      ]
    )
    expect(
      computeFitnessBestEfforts({ payload, activityType: 'ride' })
    ).toEqual([])
  })

  it('times sparse power the way the activity page does', () => {
    // One power value every 2 s across 600 s of recording.
    const payload: PreParsedRouteDataPayload = {
      ...indoorPayload(600, 8),
      powerSeries: [...new Array(297).fill(100), 400, 400, 400]
    }
    const efforts = computeFitnessBestEfforts({ payload, activityType: 'ride' })
    // 5 s is about three 2 s samples: all three at 400 W.
    expect(efforts[0]).toEqual({ kind: 'power', key: 5, value: 400 })
  })
})

describe('toEffortTimeline', () => {
  it('measures distance along the track when the file records none', () => {
    const timeline = toEffortTimeline({
      version: 1,
      totalDurationSeconds: 10,
      routeSamples: [
        { lat: 0, lng: 0, elapsedSeconds: 0 },
        { lat: 0, lng: 0.01, elapsedSeconds: 10 }
      ]
    })
    expect(timeline[0].distanceMeters).toBe(0)
    expect(timeline[1].distanceMeters).toBeCloseTo(1112, 0)
  })

  it('reads distance exactly as the activity page timeline does', () => {
    // One payload with all three sources: file distance, then a GPS-only
    // stretch, then a speed-only stretch with no track.
    const routeSamples = [
      { lat: 52, lng: 5, elapsedSeconds: 0, distanceMeters: 0 },
      { lat: 52, lng: 5.001, elapsedSeconds: 10, distanceMeters: 70 },
      { lat: 52, lng: 5.002, elapsedSeconds: 20 },
      { lat: 52.001, lng: 5.002, elapsedSeconds: 30, speed: 12 }
    ]
    const metricSamples = [
      { elapsedSeconds: 0, speed: 10 },
      { elapsedSeconds: 30, speed: 10 },
      { elapsedSeconds: 60, distanceMeters: 200 },
      { elapsedSeconds: 90, speed: 20 }
    ]
    for (const payload of [
      { version: 1, totalDurationSeconds: 30, routeSamples },
      { version: 1, totalDurationSeconds: 90, metricSamples }
    ] as PreParsedRouteDataPayload[]) {
      const page = buildActivityTimeline({
        samples: (payload.routeSamples ?? []).map((sample) => ({
          ...sample,
          isHiddenByPrivacy: false
        })),
        metricSamples: payload.metricSamples
      })
      expect(toEffortTimeline(payload)).toEqual(
        page.map(({ elapsedSeconds, distanceMeters }) => ({
          elapsedSeconds,
          distanceMeters
        }))
      )
    }
  })

  it('reports no distance when nothing can measure it', () => {
    expect(
      toEffortTimeline({
        version: 1,
        totalDurationSeconds: 1,
        metricSamples: [{ elapsedSeconds: 0 }, { elapsedSeconds: 1 }]
      }).map((point) => point.distanceMeters)
    ).toEqual([null, null])
  })
})

describe('saveFitnessBestEfforts', () => {
  it('replaces the file rows with the computed efforts', async () => {
    const database = { replaceFitnessBestEfforts: vi.fn() }
    await saveFitnessBestEfforts(database, {
      fitnessFileId: 'file-1',
      actorId: 'actor-1',
      statusId: 'status-1',
      activityType: 'run',
      activityDate: 1000,
      payload: indoorPayload(300, 4)
    })
    expect(database.replaceFitnessBestEfforts).toHaveBeenCalledWith({
      fitnessFileId: 'file-1',
      actorId: 'actor-1',
      statusId: 'status-1',
      activityType: 'run',
      activityDate: 1000,
      efforts: [{ kind: 'distance', key: 1000, value: 250 }]
    })
  })
})
