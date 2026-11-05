import {
  computeBestEfforts,
  computeDistanceEfforts,
  resolveRecordingSeconds
} from './bestEfforts'

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

  it('covers the five default durations of an hour-long ride', () => {
    const power = new Array(3600).fill(200)
    expect(
      computeBestEfforts(power).map((effort) => effort.durationSeconds)
    ).toEqual([5, 60, 300, 1200, 3600])
  })
})

// One point every `step` seconds at `metersPerSecond`.
const steadyRun = (seconds: number, metersPerSecond: number, step = 1) =>
  Array.from({ length: Math.floor(seconds / step) + 1 }, (_, index) => ({
    elapsedSeconds: index * step,
    distanceMeters: index * step * metersPerSecond
  }))

describe('computeDistanceEfforts', () => {
  it('times each distance at a steady pace', () => {
    // 4 m/s for 45 minutes: 10.8 km.
    expect(computeDistanceEfforts(steadyRun(2700, 4))).toEqual([
      { distanceMeters: 1000, seconds: 250 },
      { distanceMeters: 5000, seconds: 1250 },
      { distanceMeters: 10000, seconds: 2500 }
    ])
  })

  it('leaves out distances longer than the run', () => {
    expect(computeDistanceEfforts(steadyRun(200, 4))).toEqual([])
    expect(
      computeDistanceEfforts(steadyRun(1300, 4)).map(
        (effort) => effort.distanceMeters
      )
    ).toEqual([1000, 5000])
  })

  it('finds the fastest stretch, not the first one', () => {
    // 1 km at 4 m/s, then 1 km at 5 m/s, then 1 km at 4 m/s.
    const points = [
      { elapsedSeconds: 0, distanceMeters: 0 },
      { elapsedSeconds: 250, distanceMeters: 1000 },
      { elapsedSeconds: 450, distanceMeters: 2000 },
      { elapsedSeconds: 700, distanceMeters: 3000 }
    ]
    expect(computeDistanceEfforts(points, [1000])).toEqual([
      { distanceMeters: 1000, seconds: 200 }
    ])
  })

  it('interpolates where 1 km falls between recorded points', () => {
    // A point every 300 m at 4 m/s: no two points are 1 km apart.
    const points = [0, 300, 600, 900, 1200].map((meters) => ({
      elapsedSeconds: meters / 4,
      distanceMeters: meters
    }))
    expect(computeDistanceEfforts(points, [1000])).toEqual([
      { distanceMeters: 1000, seconds: 250 }
    ])
  })

  it('interpolates one end when the other sits on a point', () => {
    // 200 m in 100 s, 900 m in 100 s, 200 m in 100 s. No two points are 1 km
    // apart, so the fastest kilometre (150 s) starts or ends between points.
    const points = [
      { elapsedSeconds: 0, distanceMeters: 0 },
      { elapsedSeconds: 100, distanceMeters: 200 },
      { elapsedSeconds: 200, distanceMeters: 1100 },
      { elapsedSeconds: 300, distanceMeters: 1300 }
    ]
    expect(computeDistanceEfforts(points, [1000])).toEqual([
      { distanceMeters: 1000, seconds: 150 }
    ])
  })

  it('ignores points with no distance and a distance that steps back', () => {
    const points = [
      { elapsedSeconds: 0, distanceMeters: 0 },
      { elapsedSeconds: 100, distanceMeters: null },
      { elapsedSeconds: 200, distanceMeters: 1000 },
      { elapsedSeconds: 250, distanceMeters: 990 },
      { elapsedSeconds: 400, distanceMeters: 2000 }
    ]
    // Held at 1,000 m from 200 s to 250 s, then 1 km more by 400 s.
    expect(computeDistanceEfforts(points, [1000])).toEqual([
      { distanceMeters: 1000, seconds: 150 }
    ])
  })
})

describe('resolveRecordingSeconds', () => {
  it('takes the larger of the moving time and the timeline gaps', () => {
    const timeline = steadyRun(100, 1)
    expect(
      resolveRecordingSeconds({
        timeline,
        durationSeconds: 100,
        movingTimeSeconds: 80
      })
    ).toBe(100)
    expect(
      resolveRecordingSeconds({
        timeline: [],
        durationSeconds: 100,
        movingTimeSeconds: 80
      })
    ).toBe(100)
    expect(
      resolveRecordingSeconds({
        timeline: [],
        durationSeconds: 0,
        movingTimeSeconds: 80
      })
    ).toBe(80)
  })
})
