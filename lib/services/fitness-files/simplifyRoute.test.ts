import { FitnessRouteHeatmapSegment } from '@/lib/types/database/fitnessRouteHeatmap'

import { simplifyPoints, simplifySegments } from './simplifyRoute'

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
