import type { FitnessRouteDataResponse } from '@/lib/client/fitnessRoutes'

import {
  deriveActivityAnalysis,
  findPointAtElapsed,
  getChartBinCount
} from './activityAnalysis'
import type { ActivityPoint } from './fitnessActivityMetrics'

// 30 minutes at one sample per 10 s: flat for 10 min, 60 m of climbing over
// the next 10 min (1.67 km, 3.6%), then flat again.
const buildRouteData = (
  overrides: Partial<FitnessRouteDataResponse> = {}
): FitnessRouteDataResponse => {
  const count = 181
  const samples = Array.from({ length: count }, (_, index) => {
    const elapsedSeconds = index * 10
    const altitude =
      elapsedSeconds < 600
        ? 10
        : elapsedSeconds < 1200
          ? 10 + (60 * (elapsedSeconds - 600)) / 600
          : 70
    return {
      lat: 52 + index * 0.0002,
      lng: 5 + index * 0.0002,
      elapsedSeconds,
      distanceMeters: (5000 * index) / (count - 1),
      altitude,
      speed: 10,
      power: index < 30 ? 0 : 200,
      heartRate: 140,
      cadence: 85,
      temperature: 14 + (4 * index) / (count - 1)
    }
  })
  return {
    samples,
    totalDurationSeconds: 1800,
    powerSeries: samples.map((sample) => sample.power),
    heartRateSeries: samples.map((sample) => sample.heartRate),
    altitudeSeries: samples.map((sample) => sample.altitude),
    speedSeries: samples.map((sample) => sample.speed),
    laps: [0, 900].map((startElapsedSeconds) => ({
      startElapsedSeconds,
      durationSeconds: 900,
      distanceMeters: 2500
    })),
    calories: 412,
    ...overrides
  }
}

const point = (elapsedSeconds: number): ActivityPoint => ({
  elapsedSeconds,
  distanceMeters: null
})

describe('getChartBinCount', () => {
  it('bins every 5 s, between 60 and 600 bins', () => {
    expect(getChartBinCount(0)).toBe(60)
    expect(getChartBinCount(1800)).toBe(360)
    expect(getChartBinCount(4 * 3600)).toBe(600)
  })
})

describe('findPointAtElapsed', () => {
  const points = [point(0), point(10), point(20), point(40)]

  it('returns the nearest point, the earlier one on a tie', () => {
    expect(findPointAtElapsed(points, 14)?.elapsedSeconds).toBe(10)
    expect(findPointAtElapsed(points, 15)?.elapsedSeconds).toBe(10)
    expect(findPointAtElapsed(points, 31)?.elapsedSeconds).toBe(40)
  })

  it('clamps to the ends and answers null for no points', () => {
    expect(findPointAtElapsed(points, -5)?.elapsedSeconds).toBe(0)
    expect(findPointAtElapsed(points, 500)?.elapsedSeconds).toBe(40)
    expect(findPointAtElapsed([], 5)).toBeNull()
  })
})

describe('deriveActivityAnalysis', () => {
  it('derives every series on one time axis, with the summary figures', () => {
    const analysis = deriveActivityAnalysis({
      data: buildRouteData(),
      activityType: 'ride'
    })

    expect(analysis.durationSeconds).toBe(1800)
    expect(analysis.binCount).toBe(360)
    expect(analysis.series.map((series) => series.key)).toEqual([
      'elevation',
      'speed',
      'power',
      'heart-rate',
      'cadence',
      'temperature',
      'grade'
    ])
    for (const series of analysis.series) {
      expect(series.values).toHaveLength(360)
    }
    expect(analysis.cadenceUnit).toBe('rpm')
    expect(analysis.avgCadence).toBe(85)
    expect(analysis.temperature).toEqual({
      min: 14,
      max: 18,
      avg: expect.closeTo(16, 5)
    })
    expect(analysis.maxSpeedKmh).toBe(10)
    expect(analysis.calories).toBe(412)
    // 30 samples at 0 W, each worth the 1800 s spread over 181 samples.
    expect(analysis.timeAtZeroPowerSeconds).toBeCloseTo((30 * 1800) / 181)
    expect(analysis.normalizedPower).toBeGreaterThan(160)
    expect(analysis.bestEfforts[0]).toEqual({ durationSeconds: 5, watts: 200 })
    expect(analysis.laps.map((lap) => lap.subline)).toEqual([
      '0.0 – 2.5 km',
      '2.5 – 5.0 km'
    ])
    expect(analysis.climbs).toHaveLength(1)
    expect(analysis.climbs[0].gainMeters).toBeGreaterThanOrEqual(50)
  })

  it('reports cadence in steps per minute for a run', () => {
    const analysis = deriveActivityAnalysis({
      data: buildRouteData(),
      activityType: 'run'
    })

    expect(analysis.cadenceUnit).toBe('spm')
    expect(analysis.avgCadence).toBe(170)
  })

  it('leaves out what the file did not record', () => {
    const data = buildRouteData()
    const analysis = deriveActivityAnalysis({
      data: {
        ...data,
        samples: data.samples.map(
          ({ lat, lng, elapsedSeconds, distanceMeters, altitude, speed }) => ({
            lat,
            lng,
            elapsedSeconds,
            distanceMeters,
            altitude,
            speed
          })
        ),
        powerSeries: [],
        heartRateSeries: [],
        laps: [],
        calories: undefined
      },
      activityType: 'ride'
    })

    expect(analysis.series.map((series) => series.key)).toEqual([
      'elevation',
      'speed',
      'grade'
    ])
    expect(analysis.normalizedPower).toBeNull()
    expect(analysis.bestEfforts).toEqual([])
    expect(analysis.timeAtZeroPowerSeconds).toBeNull()
    expect(analysis.heartRateStats).toBeNull()
    expect(analysis.heartRateZones).toEqual([])
    expect(analysis.avgCadence).toBeNull()
    expect(analysis.temperature).toBeNull()
    expect(analysis.calories).toBeNull()
    expect(analysis.laps).toEqual([])
  })

  it('charts an indoor activity from its metric samples', () => {
    const analysis = deriveActivityAnalysis({
      data: {
        samples: [],
        totalDurationSeconds: 600,
        metricSamples: Array.from({ length: 61 }, (_, index) => ({
          elapsedSeconds: index * 10,
          power: 180,
          heartRate: 130,
          cadence: 90
        }))
      },
      activityType: 'virtual_ride'
    })

    expect(analysis.series.map((series) => series.key)).toEqual([
      'power',
      'heart-rate',
      'cadence'
    ])
    expect(analysis.avgCadence).toBe(90)
    expect(analysis.climbs).toEqual([])
  })

  it('spreads a full-resolution series over the bins when the samples lack it', () => {
    const data = buildRouteData()
    const analysis = deriveActivityAnalysis({
      data: {
        ...data,
        samples: data.samples.map(({ power: _power, ...rest }) => rest)
      },
      activityType: 'ride'
    })

    const power = analysis.series.find((series) => series.key === 'power')
    expect(power?.values).toHaveLength(360)
    expect(power?.values.at(-1)).toBe(200)
  })

  it('falls back to the given duration when the data has none', () => {
    const analysis = deriveActivityAnalysis({
      data: { samples: [], totalDurationSeconds: 0 },
      fallbackDurationSeconds: 900
    })

    expect(analysis.durationSeconds).toBe(900)
    expect(analysis.series).toEqual([])
  })
})

describe('deriveActivityAnalysis with an auto-paused recording', () => {
  // 2 h of riding recorded at 1 Hz, with a 1 h 15 min café stop the recorder
  // auto-paused after the first hour: 7200 samples over 3 h 15 min elapsed.
  const MOVING = 7200
  const STOP = 4500
  const ELAPSED = MOVING + STOP
  // 15 min at 300 W, 5 min stopped at the lights at 0 W, then 100 W.
  const power = Array.from({ length: MOVING }, (_, second) =>
    second < 900 ? 300 : second < 1200 ? 0 : 100
  )
  const elapsedAt = (second: number) => (second < 3600 ? second : second + STOP)
  const buildPausedData = (): FitnessRouteDataResponse => ({
    // The route samples are picked down to one a minute, as the server does.
    samples: Array.from({ length: MOVING / 60 }, (_, index) => ({
      lat: 52 + index * 0.0005,
      lng: 5,
      elapsedSeconds: elapsedAt(index * 60),
      power: power[index * 60],
      heartRate: 130
    })),
    totalDurationSeconds: ELAPSED,
    powerSeries: power,
    heartRateSeries: Array.from({ length: MOVING }, () => 130)
  })

  it.each([
    { source: 'the file’s moving time', movingTimeSeconds: MOVING },
    { source: 'the timeline’s own gaps', movingTimeSeconds: null }
  ])(
    'times the power and heart-rate figures by running time, from $source',
    ({ movingTimeSeconds }) => {
      const analysis = deriveActivityAnalysis({
        data: buildPausedData(),
        activityType: 'ride',
        movingTimeSeconds
      })

      expect(analysis.durationSeconds).toBe(ELAPSED)
      expect(analysis.recordingSeconds).toBe(MOVING)
      // One sample a second, so NP smooths over 30 samples, not 18.
      expect(analysis.sampleSeconds).toBe(1)
      const best = (seconds: number) =>
        analysis.bestEfforts.find(
          (effort) => effort.durationSeconds === seconds
        )?.watts
      // The best 20 min is the 15 min block plus 5 min at 0 W: 225 W. Read
      // against elapsed time it would be a 738-sample window inside the block.
      expect(best(1200)).toBe(225)
      // 60 min: 900 s at 300 W, 300 s at 0 W, 2400 s at 100 W.
      expect(best(3600)).toBe(142)
      expect(analysis.timeAtZeroPowerSeconds).toBe(300)
      // Every reading is in Z2: two hours of it, not three and a quarter.
      expect(analysis.heartRateZones.map((zone) => zone.seconds)).toEqual([
        0,
        MOVING,
        0,
        0,
        0
      ])
      // The distribution leaves out the 0-25 W bucket (the 300 s at 0 W).
      const minutes = analysis.powerDistribution.bins.reduce(
        (sum, bin) => sum + bin.minutes,
        0
      )
      expect(minutes).toBeCloseTo((MOVING - 300) / 60)
    }
  )
})

describe('deriveActivityAnalysis with smart recording through a stop', () => {
  // 3 h 15 min with one record every 2 s that keeps recording through a
  // 1 h 15 min café stop: 5850 records, and 2 h of moving time.
  const ELAPSED = 11700
  const STOP_START = 1200
  const STOP = 4500
  const MOVING = ELAPSED - STOP
  // 20 min at 300 W, the stop at 0 W, then 150 W.
  const wattsAt = (second: number) =>
    second < STOP_START ? 300 : second < STOP_START + STOP ? 0 : 150
  const power = Array.from({ length: ELAPSED / 2 }, (_, index) =>
    wattsAt(index * 2)
  )

  it('reads the records as 2 s apart, not as 1 Hz from the moving time', () => {
    const analysis = deriveActivityAnalysis({
      data: {
        // One route sample a minute, through the stop as well.
        samples: Array.from({ length: ELAPSED / 60 }, (_, index) => ({
          lat: 52 + index * 0.0005,
          lng: 5,
          elapsedSeconds: index * 60,
          power: wattsAt(index * 60),
          heartRate: 130
        })),
        totalDurationSeconds: ELAPSED,
        powerSeries: power,
        heartRateSeries: power.map(() => 130)
      },
      activityType: 'ride',
      movingTimeSeconds: MOVING
    })

    expect(analysis.recordingSeconds).toBe(ELAPSED)
    expect(analysis.sampleSeconds).toBe(2)
    // Read as 1 Hz, the 20 min window would be 1200 records (40 min) and
    // take in 20 min of the stop.
    expect(
      analysis.bestEfforts.find((effort) => effort.durationSeconds === 1200)
        ?.watts
    ).toBe(300)
    expect(analysis.timeAtZeroPowerSeconds).toBe(STOP)
    expect(analysis.heartRateZones.map((zone) => zone.seconds)).toEqual([
      0,
      ELAPSED,
      0,
      0,
      0
    ])
  })
})

describe('deriveActivityAnalysis running cadence', () => {
  const buildRun = (cadence: number): FitnessRouteDataResponse => ({
    samples: Array.from({ length: 61 }, (_, index) => ({
      lat: 52 + index * 0.0002,
      lng: 5,
      elapsedSeconds: index * 10,
      cadence
    })),
    totalDurationSeconds: 600
  })

  it('doubles a per-foot running cadence into steps per minute', () => {
    const analysis = deriveActivityAnalysis({
      data: buildRun(86),
      activityType: 'run'
    })
    expect(analysis.avgCadence).toBe(172)
  })

  it('keeps a running cadence the device already recorded in steps per minute', () => {
    const analysis = deriveActivityAnalysis({
      data: buildRun(172),
      activityType: 'run'
    })
    expect(analysis.cadenceUnit).toBe('spm')
    expect(analysis.avgCadence).toBe(172)
  })
})
