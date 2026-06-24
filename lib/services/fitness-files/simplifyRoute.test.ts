import { FitnessRouteHeatmapSegment } from '@/lib/types/database/fitnessRouteHeatmap'

import {
  simplifyPoints,
  simplifySegments,
  simplifySegmentsToBudget
} from './simplifyRoute'

const totalPoints = (segments: FitnessRouteHeatmapSegment[]) =>
  segments.reduce((sum, segment) => sum + segment.points.length, 0)

// A wiggly route whose every-other vertex deviates ~`amplitudeDeg`° from the
// baseline, so at a fine tolerance most vertices survive Douglas–Peucker.
const wigglyRoute = (count: number, amplitudeDeg: number, lngBase: number) => ({
  points: Array.from({ length: count }, (_value, index) => ({
    lat: 1.3 + index * 0.00002 + (index % 2) * amplitudeDeg,
    lng: lngBase + index * 0.00002
  }))
})

describe('simplifyPoints', () => {
  it('returns the input unchanged when there are two or fewer points', () => {
    const points = [
      { lat: 52, lng: 4 },
      { lat: 52.1, lng: 4.1 }
    ]
    expect(simplifyPoints(points, 5)).toBe(points)
  })

  it('returns the input unchanged when the tolerance is not positive', () => {
    const points = [
      { lat: 52, lng: 4 },
      { lat: 52.0001, lng: 4 },
      { lat: 52.0002, lng: 4 }
    ]
    expect(simplifyPoints(points, 0)).toBe(points)
  })

  it.each([
    { description: 'an empty route', points: [] },
    { description: 'a single-point route', points: [{ lat: 52, lng: 4 }] }
  ])('returns the input reference for $description', ({ points }) => {
    expect(simplifyPoints(points, 5)).toBe(points)
  })

  it('stays bounded and endpoint-preserving on a pathological sawtooth', () => {
    // A uniform alternating sawtooth is the O(n²) worst case for Douglas–Peucker;
    // the comparison budget must keep this fast and still return a valid
    // simplification (first and last vertices retained, no growth).
    const points = Array.from({ length: 20_000 }, (_value, index) => ({
      lat: 52 + index * 0.00001 + (index % 2) * 0.0002,
      lng: 4 + index * 0.00001
    }))

    const simplified = simplifyPoints(points, 2)

    expect(simplified[0]).toEqual(points[0])
    expect(simplified[simplified.length - 1]).toEqual(points[points.length - 1])
    expect(simplified.length).toBeGreaterThanOrEqual(2)
    expect(simplified.length).toBeLessThanOrEqual(points.length)
  })

  it('collapses collinear points to the two endpoints', () => {
    const points = Array.from({ length: 50 }, (_, index) => ({
      lat: 52 + index * 0.0001,
      lng: 4 + index * 0.0001
    }))

    const simplified = simplifyPoints(points, 2)

    expect(simplified).toHaveLength(2)
    expect(simplified[0]).toEqual(points[0])
    expect(simplified[1]).toEqual(points[points.length - 1])
  })

  it('always preserves the first and last vertex', () => {
    const points = Array.from({ length: 40 }, (_, index) => ({
      lat: 52 + index * 0.0002,
      lng: 4 + Math.sin(index) * 0.0005
    }))

    const simplified = simplifyPoints(points, 3)

    expect(simplified[0]).toEqual(points[0])
    expect(simplified[simplified.length - 1]).toEqual(points[points.length - 1])
  })

  it('keeps a corner vertex that deviates more than the tolerance', () => {
    // The midpoint sits ~5.6m north of the straight A→C line (0.00005° lat),
    // so a 3m tolerance must retain it.
    const points = [
      { lat: 52, lng: 4 },
      { lat: 52.00005, lng: 4.0005 },
      { lat: 52, lng: 4.001 }
    ]

    expect(simplifyPoints(points, 3)).toEqual(points)
  })

  it('drops a vertex whose deviation is below the tolerance', () => {
    // Same ~5.6m deviation, but an 8m tolerance treats it as on the line.
    const points = [
      { lat: 52, lng: 4 },
      { lat: 52.00005, lng: 4.0005 },
      { lat: 52, lng: 4.001 }
    ]

    const simplified = simplifyPoints(points, 8)

    expect(simplified).toEqual([points[0], points[2]])
  })

  it('returns the original reference when no vertex is dropped', () => {
    // Every interior vertex is a genuine >tolerance turn (~33m teeth), so nothing
    // is dropped and the original array reference is preserved.
    const points = [
      { lat: 52, lng: 4 },
      { lat: 52.0003, lng: 4.0001 },
      { lat: 52, lng: 4.0002 },
      { lat: 52.0003, lng: 4.0003 },
      { lat: 52, lng: 4.0004 }
    ]

    expect(simplifyPoints(points, 2)).toBe(points)
  })

  it('retains the detail of a sharp turn', () => {
    const points = [
      { lat: 52, lng: 4 },
      { lat: 52, lng: 4.002 },
      { lat: 52.002, lng: 4.002 }
    ]

    // The corner is a genuine direction change far from the A→C diagonal, so it
    // survives at a road-scale tolerance.
    expect(simplifyPoints(points, 2)).toEqual(points)
  })
})

describe('simplifySegments', () => {
  const straightSegment: FitnessRouteHeatmapSegment = {
    points: Array.from({ length: 20 }, (_, index) => ({
      lat: 52 + index * 0.0001,
      lng: 4 + index * 0.0001
    }))
  }

  it('returns the input reference unchanged when the tolerance is not positive', () => {
    const segments = [straightSegment]
    expect(simplifySegments(segments, 0)).toBe(segments)
  })

  it('simplifies each segment and preserves the privacy flag', () => {
    const segments: FitnessRouteHeatmapSegment[] = [
      { ...straightSegment, isHiddenByPrivacy: true }
    ]

    const result = simplifySegments(segments, 2)

    expect(result).toHaveLength(1)
    expect(result[0].isHiddenByPrivacy).toBe(true)
    expect(result[0].points).toHaveLength(2)
  })

  it('keeps every distinct segment rather than merging them', () => {
    const segments: FitnessRouteHeatmapSegment[] = [
      straightSegment,
      {
        points: [
          { lat: 1.3, lng: 103.8 },
          { lat: 1.31, lng: 103.81 },
          { lat: 1.32, lng: 103.82 }
        ]
      }
    ]

    expect(simplifySegments(segments, 2)).toHaveLength(2)
  })

  it('drops a segment reduced below two usable points', () => {
    const segments: FitnessRouteHeatmapSegment[] = [
      { points: [{ lat: 1, lng: 2 }] }
    ]

    expect(simplifySegments(segments, 2)).toHaveLength(0)
  })

  it('returns the original array reference when no segment changes', () => {
    // Two-point segments cannot be simplified further, so nothing changes and
    // the caller (a useMemo) keeps a stable identity.
    const segments: FitnessRouteHeatmapSegment[] = [
      {
        points: [
          { lat: 52, lng: 4 },
          { lat: 52.1, lng: 4.1 }
        ]
      },
      {
        points: [
          { lat: 1.3, lng: 103.8 },
          { lat: 1.31, lng: 103.81 }
        ]
      }
    ]

    expect(simplifySegments(segments, 2)).toBe(segments)
  })
})

describe('simplifySegmentsToBudget', () => {
  it('keeps the finest-tolerance detail when it already fits the budget', () => {
    const segments = [wigglyRoute(100, 0.0001, 103.8)]

    const result = simplifySegmentsToBudget(segments, 10_000, 1)

    // Under budget at the fine tolerance, so most of the wiggle is retained.
    expect(totalPoints(result)).toBeLessThanOrEqual(10_000)
    expect(totalPoints(result)).toBeGreaterThan(50)
  })

  it('coarsens the tolerance until the geometry fits the budget', () => {
    const segments = Array.from({ length: 10 }, (_value, index) =>
      wigglyRoute(200, 0.0001, 103 + index)
    )

    const atFinest = totalPoints(simplifySegments(segments, 1))
    const fitted = simplifySegmentsToBudget(segments, 500, 1)

    // The fine tolerance overflows the budget; coarsening brings it under while
    // keeping every segment (>= 2 points), i.e. shape-preserving, not uniformly
    // decimated.
    expect(atFinest).toBeGreaterThan(500)
    expect(totalPoints(fitted)).toBeLessThanOrEqual(500)
    expect(fitted.every((segment) => segment.points.length >= 2)).toBe(true)
  })

  it('returns the input reference when the base pass already fits and changes nothing', () => {
    const segments: FitnessRouteHeatmapSegment[] = [
      {
        points: [
          { lat: 1, lng: 2 },
          { lat: 1.1, lng: 2.1 }
        ]
      }
    ]

    expect(simplifySegmentsToBudget(segments, 1_000, 1)).toBe(segments)
  })

  it('returns the input reference when the base tolerance is not positive', () => {
    const segments = [wigglyRoute(50, 0.0001, 103.8)]
    expect(simplifySegmentsToBudget(segments, 10, 0)).toBe(segments)
  })

  it('stops coarsening once every segment is at the 2-point minimum', () => {
    // Five 2-point segments (10 points) over a budget of 4: coarsening cannot
    // drop any further (each is already minimal), so it returns them unchanged
    // for the caller's uniform backstop instead of looping.
    const segments: FitnessRouteHeatmapSegment[] = Array.from(
      { length: 5 },
      (_value, index) => ({
        points: [
          { lat: index, lng: index },
          { lat: index + 0.1, lng: index + 0.1 }
        ]
      })
    )

    const result = simplifySegmentsToBudget(segments, 4, 1)

    expect(result).toBe(segments)
    expect(totalPoints(result)).toBe(10)
  })
})
