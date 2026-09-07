import { describe, expect, it } from 'vitest'

import {
  EARTH_RADIUS_METERS,
  FitnessTrackPoint,
  getDistanceFromCoordinates,
  getDurationSeconds,
  getElevationGain,
  getMovingTimeSeconds,
  getSegmentSpeedMetersPerSecond,
  haversineDistanceMeters,
  toActivityData
} from './activityData'

describe('activityData', () => {
  describe('haversineDistanceMeters', () => {
    it('returns 0 for identical coordinates', () => {
      const coord = { lat: 37.7749, lng: -122.4194 }
      expect(haversineDistanceMeters(coord, coord)).toBe(0)
    })

    it('calculates approximately correct distance for 1 degree latitude', () => {
      const coord1 = { lat: 0, lng: 0 }
      const coord2 = { lat: 1, lng: 0 }
      const distance = haversineDistanceMeters(coord1, coord2)
      // 1 degree latitude is approximately (pi / 180) * 6371000 = ~111,195 meters
      const expected = (Math.PI / 180) * EARTH_RADIUS_METERS
      expect(Math.abs(distance - expected)).toBeLessThan(1)
    })
  })

  describe('getDistanceFromCoordinates', () => {
    it('returns 0 for fewer than 2 coordinates', () => {
      expect(getDistanceFromCoordinates([])).toBe(0)
      expect(getDistanceFromCoordinates([{ lat: 10, lng: 20 }])).toBe(0)
    })

    it('accumulates distance across multiple segments', () => {
      const p1 = { lat: 0, lng: 0 }
      const p2 = { lat: 1, lng: 0 }
      const p3 = { lat: 2, lng: 0 }
      const expected =
        haversineDistanceMeters(p1, p2) + haversineDistanceMeters(p2, p3)
      expect(getDistanceFromCoordinates([p1, p2, p3])).toBeCloseTo(expected, 5)
    })
  })

  describe('getElevationGain', () => {
    it('returns undefined if no altitude gain occurs', () => {
      expect(getElevationGain([])).toBeUndefined()
      expect(getElevationGain([100, 90, 80])).toBeUndefined()
      expect(getElevationGain([undefined, undefined])).toBeUndefined()
    })

    it('accumulates only positive ascent and skips undefined values', () => {
      expect(getElevationGain([100, 150, undefined, 140, 200])).toBe(110)
    })
  })

  describe('getSegmentSpeedMetersPerSecond', () => {
    it('averages device speeds converted from km/h to m/s', () => {
      const p1: FitnessTrackPoint = { lat: 0, lng: 0, speed: 36 } // 10 m/s
      const p2: FitnessTrackPoint = { lat: 0, lng: 0, speed: 18 } // 5 m/s
      expect(getSegmentSpeedMetersPerSecond(p1, p2, 1)).toBeCloseTo(7.5, 5)
    })

    it('falls back to GPS haversine distance over delta seconds if no device speed', () => {
      const p1: FitnessTrackPoint = { lat: 0, lng: 0 }
      const p2: FitnessTrackPoint = { lat: 1, lng: 0 }
      const delta = 100
      const expected = haversineDistanceMeters(p1, p2) / delta
      expect(getSegmentSpeedMetersPerSecond(p1, p2, delta)).toBeCloseTo(
        expected,
        5
      )
    })

    it('returns undefined when delta is zero and no device speeds', () => {
      const p1: FitnessTrackPoint = { lat: 0, lng: 0 }
      const p2: FitnessTrackPoint = { lat: 1, lng: 0 }
      expect(getSegmentSpeedMetersPerSecond(p1, p2, 0)).toBeUndefined()
    })
  })

  describe('getMovingTimeSeconds', () => {
    it('returns undefined when there are fewer than 2 valid timestamped points', () => {
      expect(getMovingTimeSeconds([])).toBeUndefined()
      expect(
        getMovingTimeSeconds([
          { lat: 0, lng: 0, timestamp: new Date('2025-01-01T00:00:00Z') }
        ])
      ).toBeUndefined()
      expect(
        getMovingTimeSeconds([
          { lat: 0, lng: 0 },
          { lat: 0, lng: 0 }
        ])
      ).toBeUndefined()
    })

    it('accumulates moving segments and excludes stopped segments', () => {
      const t0 = new Date('2025-01-01T00:00:00Z')
      const t1 = new Date('2025-01-01T00:00:10Z') // +10s, moving at 5 m/s (18 km/h)
      const t2 = new Date('2025-01-01T00:00:20Z') // +10s, stopped at 0.1 m/s (0.36 km/h)
      const t3 = new Date('2025-01-01T00:00:30Z') // +10s, moving at 10 m/s (36 km/h)

      const points: FitnessTrackPoint[] = [
        { lat: 0, lng: 0, timestamp: t0, speed: 18 },
        { lat: 0, lng: 0, timestamp: t1, speed: 18 },
        { lat: 0, lng: 0, timestamp: t2, speed: 0.36 },
        { lat: 0, lng: 0, timestamp: t3, speed: 36 }
      ]

      // Segment 1 (t0->t1): avg speed 18 km/h (5 m/s) > 0.5 => 10s
      // Segment 2 (t1->t2): avg speed (18+0.36)/2 = 9.18 km/h (2.55 m/s) > 0.5 => 10s
      // Segment 3 (t2->t3): avg speed (0.36+36)/2 = 18.18 km/h (5.05 m/s) > 0.5 => 10s
      expect(getMovingTimeSeconds(points)).toBe(30)
      const pointsWithStop: FitnessTrackPoint[] = [
        { lat: 0, lng: 0, timestamp: t0, speed: 18 },
        { lat: 0, lng: 0, timestamp: t1, speed: 18 }, // 10s moving
        { lat: 0, lng: 0, timestamp: t2, speed: 0 }, // transition: (18+0)/2 = 9 km/h (2.5 m/s)
        {
          lat: 0,
          lng: 0,
          timestamp: new Date('2025-01-01T00:00:30Z'),
          speed: 0
        }, // both 0: stopped! (0 s added)
        {
          lat: 0,
          lng: 0,
          timestamp: new Date('2025-01-01T00:00:40Z'),
          speed: 18
        } // moving again
      ]

      const movingTime = getMovingTimeSeconds(pointsWithStop)
      // total time is 40s; interval 20->30s was completely stopped (0 speed on both)
      expect(movingTime).toBe(30)
    })
  })

  describe('getDurationSeconds', () => {
    it('uses fallback if valid positive number', () => {
      expect(
        getDurationSeconds(
          new Date('2025-01-01T00:00:00Z'),
          new Date('2025-01-01T00:10:00Z'),
          300
        )
      ).toBe(300)
    })

    it('calculates duration from start and end time if fallback is not provided', () => {
      expect(
        getDurationSeconds(
          new Date('2025-01-01T00:00:00Z'),
          new Date('2025-01-01T00:10:00Z')
        )
      ).toBe(600)
    })

    it('returns 0 when no times or fallback are available', () => {
      expect(getDurationSeconds()).toBe(0)
    })
  })

  describe('toActivityData', () => {
    it('normalizes activity data correctly', () => {
      const t1 = new Date('2025-01-01T10:00:00Z')
      const t2 = new Date('2025-01-01T10:05:00Z')
      const points: FitnessTrackPoint[] = [
        {
          lat: 37.77,
          lng: -122.41,
          timestamp: t1,
          altitudeMeters: 10,
          heartRate: 140,
          power: 200,
          speed: 25
        },
        {
          lat: 37.78,
          lng: -122.42,
          timestamp: t2,
          altitudeMeters: 25,
          heartRate: 155,
          power: 220,
          speed: 28
        }
      ]

      const result = toActivityData({
        points,
        activityType: 'Biking',
        totalDistanceMeters: 1500,
        totalDurationSeconds: 300
      })

      expect(result.activityType).toBe('ride')
      expect(result.rawActivityType).toBe('Biking')
      expect(result.totalDistanceMeters).toBe(1500)
      expect(result.totalDurationSeconds).toBe(300)
      expect(result.elevationGainMeters).toBe(15)
      expect(result.heartRateSeries).toEqual([140, 155])
      expect(result.powerSeries).toEqual([200, 220])
      expect(result.speedSeries).toEqual([25, 28])
      expect(result.altitudeSeries).toEqual([10, 25])
      expect(result.startTime).toEqual(t1)
    })

    it('clamps moving time so it never exceeds total duration', () => {
      const t1 = new Date('2025-01-01T10:00:00Z')
      const t2 = new Date('2025-01-01T10:05:00Z')
      const points: FitnessTrackPoint[] = [
        { lat: 0, lng: 0, timestamp: t1, speed: 20 },
        { lat: 0, lng: 0, timestamp: t2, speed: 20 }
      ]

      const result = toActivityData({
        points,
        totalDurationSeconds: 150 // shorter than trackpoint span of 300s
      })

      expect(result.totalDurationSeconds).toBe(150)
      expect(result.movingTimeSeconds).toBe(150)
    })
  })
})
