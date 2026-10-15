import { describe, expect, it } from 'vitest'

import type { FitnessRouteSample } from '@/lib/client/fitnessRoutes'

import {
  type ActivityPoint,
  CLIMB_MIN_GAIN_METERS,
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
  estimateRecordingSeconds,
  estimateSampleSeconds,
  formatLapPattern,
  getCadenceMultiplier,
  getSeriesScale,
  haversineMeters,
  spreadSeriesOverBins,
  summarizeRange
} from './fitnessActivityMetrics'

/** A straight road north, one point every `stepMeters`, one per 10 s. */
const buildRoad = (
  altitudes: number[],
  stepMeters = 100,
  extra: (index: number) => Partial<ActivityPoint> = () => ({})
): ActivityPoint[] =>
  altitudes.map((altitude, index) => ({
    elapsedSeconds: index * 10,
    distanceMeters: index * stepMeters,
    altitude,
    ...extra(index)
  }))

describe('haversineMeters', () => {
  it('measures one degree of latitude as about 111 km', () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(
      111_195,
      -2
    )
  })
})

describe('getCadenceMultiplier', () => {
  it.each([
    ['running', 2],
    ['TrailRun', 2],
    ['cycling', 1],
    ['walk', 1],
    [null, 1]
  ])('returns %s → %i', (activityType, expected) => {
    expect(getCadenceMultiplier(activityType)).toBe(expected)
  })

  it('leaves a run recorded in steps per minute as it is', () => {
    expect(getCadenceMultiplier('run', [0, 168, 172, 176, 0])).toBe(1)
    expect(getCadenceMultiplier('run', [84, 86, 88])).toBe(2)
    // At the threshold it is still read per foot.
    expect(getCadenceMultiplier('run', [120])).toBe(2)
    // A ride's rpm is never touched, however high.
    expect(getCadenceMultiplier('ride', [130])).toBe(1)
  })
})

describe('estimateRecordingSeconds', () => {
  const at = (elapsedSeconds: number) => ({
    elapsedSeconds,
    distanceMeters: null
  })

  it('takes a long pause out, counting it as one usual gap', () => {
    // A point a minute for 30 min, a 20 min pause, then 30 min more.
    const points = [
      ...Array.from({ length: 31 }, (_, index) => at(index * 60)),
      ...Array.from({ length: 30 }, (_, index) => at(3000 + index * 60))
    ]
    // 61 points a minute apart, the pause counted as one minute.
    expect(estimateRecordingSeconds(points, 0)).toBe(61 * 60)
    // Never more than the elapsed time.
    expect(estimateRecordingSeconds(points, 3000)).toBe(3000)
  })

  it('falls back when there are too few points to tell', () => {
    expect(estimateRecordingSeconds([at(0), at(10)], 99)).toBe(99)
    expect(estimateRecordingSeconds([], 42)).toBe(42)
  })
})

describe('buildActivityTimeline', () => {
  it('keeps the file distance and doubles cadence for a run', () => {
    const samples: FitnessRouteSample[] = [
      { lat: 0, lng: 0, elapsedSeconds: 0, distanceMeters: 0, cadence: 80 },
      { lat: 0, lng: 0.001, elapsedSeconds: 5, distanceMeters: 20, cadence: 82 }
    ]
    const timeline = buildActivityTimeline({ samples, cadenceMultiplier: 2 })
    expect(timeline.map((point) => point.distanceMeters)).toEqual([0, 20])
    expect(timeline.map((point) => point.cadence)).toEqual([160, 164])
  })

  it('measures distance along the track when the file has none', () => {
    const timeline = buildActivityTimeline({
      samples: [
        { lat: 0, lng: 0, elapsedSeconds: 0 },
        { lat: 0.001, lng: 0, elapsedSeconds: 10 }
      ]
    })
    expect(timeline[1].distanceMeters).toBeCloseTo(111.2, 0)
  })

  it('integrates speed for metric samples without GPS', () => {
    const timeline = buildActivityTimeline({
      samples: [],
      metricSamples: [
        { elapsedSeconds: 0, speed: 36, power: 200 },
        { elapsedSeconds: 10, speed: 36, power: 210 }
      ]
    })
    expect(timeline[1].distanceMeters).toBe(100)
    expect(timeline[1].lat).toBeUndefined()
  })

  it('leaves distance null when nothing measures it', () => {
    const timeline = buildActivityTimeline({
      samples: [],
      metricSamples: [
        { elapsedSeconds: 0, heartRate: 120 },
        { elapsedSeconds: 1, heartRate: 0 }
      ]
    })
    expect(timeline.map((point) => point.distanceMeters)).toEqual([null, null])
    expect(timeline[1].heartRate).toBeUndefined()
  })
})

describe('computeGradeSeries', () => {
  it('reads a steady 5% road as 5%', () => {
    const road = buildRoad(
      Array.from({ length: 20 }, (_, index) => index * 5),
      100
    )
    const grades = computeGradeSeries(road)
    expect(grades[10]).toBeCloseTo(5)
  })

  it('gives no grade without altitude', () => {
    expect(
      computeGradeSeries([{ elapsedSeconds: 0, distanceMeters: 0 }])
    ).toEqual([null])
  })

  it('clamps altimeter spikes to 30%', () => {
    const road = buildRoad([0, 0, 200, 200], 25)
    expect(Math.max(...(computeGradeSeries(road) as number[]))).toBe(30)
  })
})

describe('binValuesByTime', () => {
  it('averages the points that fall in each slice of time', () => {
    const points = buildRoad([0, 0, 0, 0])
    expect(binValuesByTime(points, [10, 20, 30, 40], 40, 2)).toEqual([15, 35])
  })

  it('bridges a short gap and keeps a long one', () => {
    const points: ActivityPoint[] = [0, 50, 100].map((elapsedSeconds) => ({
      elapsedSeconds,
      distanceMeters: null
    }))
    const bridged = binValuesByTime(points, [0, null, 20], 100, 3)
    expect(bridged).toEqual([0, 10, 20])
    const gapped = binValuesByTime(points, [0, null, 20], 100, 10)
    expect(gapped[5]).toBeNull()
  })
})

describe('spreadSeriesOverBins', () => {
  it('stretches a short series and shrinks a long one', () => {
    expect(spreadSeriesOverBins([1, 2], 4)).toEqual([1, 1, 2, 2])
    expect(spreadSeriesOverBins([1, 3, 5, 7], 2)).toEqual([2, 6])
  })
})

describe('getSeriesScale', () => {
  it.each([
    ['power', [100, 250], { min: 0, max: 260 }],
    ['temperature', [14.2, 18.6], { min: 12, max: 21 }],
    ['grade', [-3, 2], { min: -5, max: 5 }]
  ] as const)('scales %s', (key, values, expected) => {
    const scale = getSeriesScale(key, [...values])
    expect(scale.min).toBeCloseTo(expected.min)
    expect(scale.max).toBeCloseTo(expected.max)
  })
})

describe('estimateSampleSeconds', () => {
  it.each([
    [3600, 3600, 1],
    [3000, 3600, 1],
    [1200, 3600, 3]
  ])(
    'reads %i samples over %i s as %i s apart',
    (count, duration, expected) => {
      expect(estimateSampleSeconds(count, duration)).toBe(expected)
    }
  )
})

describe('computeNormalizedPower', () => {
  it('equals the average for a steady effort', () => {
    expect(computeNormalizedPower(new Array(120).fill(200))).toBe(200)
  })

  it('weights surges above the average', () => {
    const intervals = Array.from({ length: 600 }, (_, index) =>
      Math.floor(index / 60) % 2 === 0 ? 300 : 100
    )
    expect(computeNormalizedPower(intervals)).toBeGreaterThan(200)
  })

  it('returns null for a ride shorter than 30 s', () => {
    expect(computeNormalizedPower([100, 200])).toBeNull()
  })
})

describe('computeBestEfforts', () => {
  it('finds the best average for each duration that fits', () => {
    const power = [...new Array(60).fill(100), ...new Array(5).fill(500)]
    expect(computeBestEfforts(power, 1, [5, 60, 300])).toEqual([
      { durationSeconds: 5, watts: 500 },
      { durationSeconds: 60, watts: Math.round((55 * 100 + 5 * 500) / 60) }
    ])
  })

  it('scales the window to sparse recordings', () => {
    expect(computeBestEfforts([100, 400, 100], 5, [5])).toEqual([
      { durationSeconds: 5, watts: 400 }
    ])
  })
})

describe('computePowerCurve', () => {
  it('starts at the peak and stops at the longest duration that fits', () => {
    const power = Array.from({ length: 900 }, (_, index) => 400 - index / 3)
    const curve = computePowerCurve(power)
    expect(curve[0]).toEqual({ durationSeconds: 1, watts: 400 })
    curve.slice(1).forEach((point, index) => {
      expect(point.watts).toBeLessThanOrEqual(curve[index].watts)
    })
    expect(curve[curve.length - 1].durationSeconds).toBe(900)
  })
})

describe('computeTimeAtZeroPowerSeconds', () => {
  it('counts coasting samples', () => {
    expect(computeTimeAtZeroPowerSeconds([0, 0, 150, 0], 2)).toBe(6)
  })
})

describe('computeLeftRightBalance', () => {
  it('averages the left share while pedalling', () => {
    expect(
      computeLeftRightBalance([
        {
          elapsedSeconds: 0,
          distanceMeters: null,
          power: 200,
          leftRightBalance: 48
        },
        {
          elapsedSeconds: 1,
          distanceMeters: null,
          power: 0,
          leftRightBalance: 90
        },
        {
          elapsedSeconds: 2,
          distanceMeters: null,
          power: 220,
          leftRightBalance: 50
        }
      ])
    ).toEqual({ left: 49, right: 51 })
  })

  it('returns null without balance data', () => {
    expect(computeLeftRightBalance([])).toBeNull()
  })
})

describe('computeDecouplingPercent', () => {
  it('reports the drop in power per heartbeat', () => {
    const points: ActivityPoint[] = Array.from({ length: 40 }, (_, index) => ({
      elapsedSeconds: index,
      distanceMeters: null,
      power: 200,
      heartRate: index < 20 ? 100 : 125
    }))
    expect(computeDecouplingPercent(points)).toBeCloseTo(20)
  })

  it('returns null without enough paired readings', () => {
    expect(
      computeDecouplingPercent([
        { elapsedSeconds: 0, distanceMeters: null, power: 100, heartRate: 100 }
      ])
    ).toBeNull()
  })
})

describe('summarizeRange', () => {
  it('averages only the points inside the range', () => {
    const road = buildRoad([0, 10, 20, 30, 30], 100, (index) => ({
      power: index * 100,
      heartRate: 120 + index,
      cadence: index === 1 ? 0 : 90
    }))
    const summary = summarizeRange(road, { startSeconds: 10, endSeconds: 30 })
    expect(summary.distanceMeters).toBe(200)
    expect(summary.avgPower).toBe(200)
    expect(summary.avgHeartRate).toBe(122)
    expect(summary.avgCadence).toBe(90)
    expect(summary.gainMeters).toBeGreaterThan(0)
  })
})

describe('buildLapSplits', () => {
  const road = buildRoad(
    Array.from({ length: 31 }, () => 0),
    100,
    (index) => ({ power: 200, timestamp: 1_000_000 + index * 10_000 })
  )

  it('places laps by their timestamps and labels their distance', () => {
    const splits = buildLapSplits(
      [
        {
          startElapsedSeconds: 0,
          startTimestamp: 1_000_000,
          durationSeconds: 150,
          distanceMeters: 1500,
          avgPower: 180,
          avgCadence: 85
        },
        {
          startElapsedSeconds: 151,
          startTimestamp: 1_150_000,
          durationSeconds: 150,
          distanceMeters: 1500
        }
      ],
      road,
      { totalDurationSeconds: 300, cadenceMultiplier: 2 }
    )
    expect(splits.map((split) => split.subline)).toEqual([
      '0.0 – 1.5 km',
      '1.5 – 3.0 km'
    ])
    expect(splits[0]).toMatchObject({
      label: 'Lap 1',
      startSeconds: 0,
      endSeconds: 150,
      avgPower: 180,
      avgCadence: 170,
      avgSpeedKmh: 36
    })
    // No lap aggregate: averaged from the timeline instead.
    expect(splits[1].avgPower).toBe(200)
    expect(splits[1].endSeconds).toBe(300)
  })

  it('falls back to the elapsed offsets when there is no timestamp to place a lap by', () => {
    const untimed = buildRoad(
      Array.from({ length: 31 }, () => 0),
      100,
      () => ({ power: 200 })
    )
    const laps = [
      {
        startElapsedSeconds: 0,
        startTimestamp: 1_000_000,
        durationSeconds: 100,
        distanceMeters: 1000
      },
      {
        startElapsedSeconds: 100,
        // A timestamp that disagrees with the offset: with no timeline
        // timestamp to anchor it, it cannot be used.
        startTimestamp: 9_000_000,
        durationSeconds: 200,
        distanceMeters: 2000
      }
    ]
    // Neither the timeline nor (for the second call) the laps carry a clock.
    for (const [points, lapsToUse] of [
      [untimed, laps],
      [road, laps.map(({ startTimestamp: _unused, ...lap }) => lap)]
    ] as const) {
      const splits = buildLapSplits([...lapsToUse], points, {
        totalDurationSeconds: 300
      })
      expect(
        splits.map(({ startSeconds, endSeconds }) => [startSeconds, endSeconds])
      ).toEqual([
        [0, 100],
        [100, 300]
      ])
    }
  })

  it("converts the file's raw lap cadence but not the timeline's, which is already converted", () => {
    const running = buildRoad(
      Array.from({ length: 31 }, () => 0),
      30,
      () => ({ cadence: 170 })
    )
    const splits = buildLapSplits(
      [
        {
          startElapsedSeconds: 0,
          durationSeconds: 150,
          distanceMeters: 450,
          avgCadence: 84
        },
        { startElapsedSeconds: 150, durationSeconds: 150, distanceMeters: 450 }
      ],
      running,
      { totalDurationSeconds: 300, cadenceMultiplier: 2 }
    )
    expect(splits.map((split) => split.avgCadence)).toEqual([168, 170])
  })

  it('averages every column from the timeline for a lap the file gives no aggregates for', () => {
    const climbing = buildRoad(
      Array.from({ length: 31 }, (_, index) => index * 2),
      100,
      (index) => ({
        power: index < 15 ? 100 : 300,
        heartRate: 140,
        cadence: 90
      })
    )
    const [split] = buildLapSplits(
      [{ startElapsedSeconds: 150, durationSeconds: 150, distanceMeters: 0 }],
      climbing,
      { totalDurationSeconds: 300 }
    )
    expect(split).toMatchObject({
      startSeconds: 150,
      endSeconds: 300,
      distanceMeters: 1500,
      subline: '0.0 – 1.5 km',
      avgSpeedKmh: 36,
      avgPower: 300,
      avgHeartRate: 140,
      avgCadence: 90
    })
    expect(split.gainMeters).toBeGreaterThan(0)
    expect(split.gradePercent).toBeCloseTo((split.gainMeters as number) / 15)
  })
})

describe('detectClimbs', () => {
  it('finds a climb and ignores small bumps', () => {
    const altitudes = [
      ...new Array(10).fill(10),
      ...Array.from({ length: 10 }, (_, index) => 10 + index * 4),
      ...new Array(10).fill(46),
      ...Array.from({ length: 10 }, (_, index) => 46 - index * 4),
      12,
      15,
      12,
      ...new Array(10).fill(10)
    ]
    const climbs = detectClimbs(buildRoad(altitudes))
    expect(climbs).toHaveLength(1)
    expect(climbs[0].gainMeters).toBeGreaterThanOrEqual(CLIMB_MIN_GAIN_METERS)
    expect(climbs[0].startDistanceMeters).toBeGreaterThanOrEqual(800)
    expect(climbs[0].lengthMeters).toBeGreaterThanOrEqual(900)
  })

  it('splits two climbs separated by a descent', () => {
    const up = Array.from({ length: 10 }, (_, index) => index * 4)
    const down = Array.from({ length: 6 }, (_, index) => 36 - index * 4)
    const altitudes = [...up, ...down, ...up.map((value) => value + 16)]
    expect(detectClimbs(buildRoad(altitudes))).toHaveLength(2)
  })

  it('finds nothing on a flat road', () => {
    expect(detectClimbs(buildRoad(new Array(50).fill(5)))).toEqual([])
  })
})

describe('buildClimbSplits', () => {
  it('labels climbs by where they start', () => {
    const [split] = buildClimbSplits(
      [
        {
          startSeconds: 100,
          endSeconds: 400,
          startDistanceMeters: 10_800,
          lengthMeters: 1800,
          gainMeters: 39
        }
      ],
      []
    )
    expect(split).toMatchObject({
      label: 'Climb 1',
      subline: 'from km 10.8',
      durationSeconds: 300,
      avgSpeedKmh: 21.6
    })
    expect(split.gradePercent).toBeCloseTo(2.17, 2)
  })
})

describe('formatLapPattern', () => {
  const lap = (distanceMeters: number | null) =>
    ({ distanceMeters }) as Parameters<typeof formatLapPattern>[0][number]

  it.each([
    [[5000, 5000, 3800], '3 × 5 km'],
    [[1000, 1000], '2 × 1 km'],
    [[5000, 3000, 5000], '3'],
    [[2500], '1']
  ])('formats %j as %s', (distances, expected) => {
    expect(formatLapPattern(distances.map(lap))).toBe(expected)
  })
})

describe('buildPowerDistribution', () => {
  it('drops coasting and folds the sparse top end', () => {
    const power = [
      ...new Array(600).fill(0),
      ...new Array(3000).fill(160),
      ...new Array(600).fill(210),
      900
    ]
    const distribution = buildPowerDistribution(power)
    expect(distribution.bins[0].fromWatts).toBe(25)
    expect(distribution.isLastOpenEnded).toBe(true)
    expect(distribution.bins[distribution.bins.length - 1].fromWatts).toBe(200)
    const total = distribution.bins.reduce((sum, bin) => sum + bin.minutes, 0)
    expect(total).toBeCloseTo(3601 / 60)
  })

  it('is empty without pedalling', () => {
    expect(buildPowerDistribution([0, 0]).bins).toEqual([])
  })
})
