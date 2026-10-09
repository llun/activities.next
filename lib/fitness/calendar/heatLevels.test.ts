import {
  HEAT_METRICS,
  HeatMetric,
  legendFor,
  levelFor,
  levelForDay,
  metricValue
} from './heatLevels'

const KM = 1000
const MIN = 60
const HOUR = 3600

describe('levelFor', () => {
  describe('count', () => {
    it.each([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 4],
      [37, 4]
    ])('%i activities is level %i', (count, level) => {
      expect(levelFor('count', count)).toBe(level)
    })
  })

  describe('distance bands: <10, 10-25, 25-50, 50+ km', () => {
    it.each([
      [0, 0],
      [1, 1],
      [9.9 * KM, 1],
      [9999, 1],
      [10 * KM, 2],
      [24.9 * KM, 2],
      [25 * KM, 3],
      [49.99 * KM, 3],
      [50 * KM, 4],
      [200 * KM, 4]
    ])('%d m is level %i', (meters, level) => {
      expect(levelFor('distance', meters)).toBe(level)
    })
  })

  describe('duration bands: <30m, 30m-1h, 1-2h, 2h+', () => {
    it.each([
      [0, 0],
      [1, 1],
      [29 * MIN + 59, 1],
      [30 * MIN, 2],
      [59 * MIN + 59, 2],
      [HOUR, 3],
      [2 * HOUR - 1, 3],
      [2 * HOUR, 4],
      [9 * HOUR, 4]
    ])('%d s is level %i', (seconds, level) => {
      expect(levelFor('duration', seconds)).toBe(level)
    })
  })

  it.each(HEAT_METRICS)(
    'treats %s values with no data as a rest day',
    (metric) => {
      expect(levelFor(metric, -5)).toBe(0)
      expect(levelFor(metric, Number.NaN)).toBe(0)
      expect(levelFor(metric, Number.POSITIVE_INFINITY)).toBe(0)
    }
  )

  it('is monotonic for every metric', () => {
    for (const metric of HEAT_METRICS) {
      let previous = 0
      for (let value = 0; value <= 20 * HOUR; value += 37) {
        const level = levelFor(metric, value)
        expect(level).toBeGreaterThanOrEqual(previous)
        previous = level
      }
    }
  })

  it('is a pure function of the value, so scales never depend on the range', () => {
    // The same value maps to the same level whatever else was asked before:
    // there is no range maximum or other state to read.
    const before = levelFor('distance', 12 * KM)
    levelFor('distance', 900 * KM)
    levelFor('distance', 0)
    expect(levelFor('distance', 12 * KM)).toBe(before)
    expect(before).toBe(2)
  })
})

describe('levelForDay and metricValue', () => {
  const day = { count: 2, distanceMeters: 42_600, durationSeconds: 4440 }

  it('reads the value of the chosen metric', () => {
    expect(metricValue('count', day)).toBe(2)
    expect(metricValue('distance', day)).toBe(42_600)
    expect(metricValue('duration', day)).toBe(4440)
  })

  it('maps each metric to its own level for the same day', () => {
    expect(levelForDay('count', day)).toBe(2)
    expect(levelForDay('distance', day)).toBe(3)
    expect(levelForDay('duration', day)).toBe(3)
  })
})

describe('legendFor', () => {
  const labels = (metric: HeatMetric) =>
    legendFor(metric).map((entry) => entry.label)

  it('is exactly 0, 1, 2, 3, 4+ for the count', () => {
    expect(labels('count')).toEqual(['0', '1', '2', '3', '4+'])
  })

  it('shows the distance bands with units, including on 0', () => {
    expect(labels('distance')).toEqual([
      '0 km',
      '<10 km',
      '10–25 km',
      '25–50 km',
      '50+ km'
    ])
  })

  it('shows the duration bands with units, including on 0', () => {
    expect(labels('duration')).toEqual(['0m', '<30m', '30m–1h', '1–2h', '2h+'])
  })

  it.each(HEAT_METRICS)(
    'has five entries for levels 0-4 in order (%s)',
    (metric) => {
      expect(legendFor(metric).map((entry) => entry.level)).toEqual([
        0, 1, 2, 3, 4
      ])
    }
  )

  it.each(['distance', 'duration'] as const)(
    'labels every %s entry with a unit',
    (metric) => {
      const unit = metric === 'distance' ? /km$/ : /[mh]\+?$/
      for (const label of labels(metric)) expect(label).toMatch(unit)
    }
  )

  it('agrees with levelFor at each band edge', () => {
    // The first value of each legend band lands on that band's level.
    expect(levelFor('distance', 10 * KM)).toBe(2) // "10-25 km"
    expect(levelFor('distance', 25 * KM)).toBe(3) // "25-50 km"
    expect(levelFor('distance', 50 * KM)).toBe(4) // "50+ km"
    expect(levelFor('duration', 30 * MIN)).toBe(2) // "30m-1h"
    expect(levelFor('duration', HOUR)).toBe(3) // "1-2h"
    expect(levelFor('duration', 2 * HOUR)).toBe(4) // "2h+"
  })
})
