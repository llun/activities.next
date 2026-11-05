import { cumulativeDistances, haversineMeters } from './cumulativeDistance'

describe('cumulativeDistances', () => {
  it('reads the file’s own distance and carries it over gaps', () => {
    expect(
      cumulativeDistances([
        { elapsedSeconds: 0, distanceMeters: 0 },
        { elapsedSeconds: 10, distanceMeters: 40 },
        { elapsedSeconds: 20 },
        { elapsedSeconds: 30, distanceMeters: 120 }
      ])
    ).toEqual([0, 40, 40, 120])
  })

  it('measures along the track when the file records no distance', () => {
    const from = { lat: 0, lng: 0 }
    const to = { lat: 0, lng: 0.01 }
    expect(
      cumulativeDistances([
        { elapsedSeconds: 0, ...from },
        { elapsedSeconds: 10, ...to }
      ])
    ).toEqual([0, haversineMeters(from, to)])
  })

  it('integrates speed over time with neither distance nor a track', () => {
    // 36 km/h is 10 m/s.
    expect(
      cumulativeDistances([
        { elapsedSeconds: 0, speed: 36 },
        { elapsedSeconds: 5, speed: 36 },
        { elapsedSeconds: 15, speed: 18 }
      ])
    ).toEqual([0, 50, 100])
  })

  it('is null when nothing can measure distance', () => {
    expect(
      cumulativeDistances([{ elapsedSeconds: 0 }, { elapsedSeconds: 1 }])
    ).toBeNull()
  })
})
