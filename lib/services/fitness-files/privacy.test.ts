import {
  downsamplePrivacySegments,
  getDistanceMeters,
  getVisibleSegments
} from './privacy'

interface SamplePoint {
  lat: number
  lng: number
  isHiddenByPrivacy: boolean
}

const createSegment = (segmentIndex: number, pointCount = 2) => ({
  isHiddenByPrivacy: segmentIndex % 2 === 0,
  points: Array.from({ length: pointCount }, (_, pointIndex) => {
    const offset = segmentIndex * 10 + pointIndex
    return {
      lat: 52.1 + offset * 0.0001,
      lng: 5.1 + offset * 0.0001,
      isHiddenByPrivacy: segmentIndex % 2 === 0
    } satisfies SamplePoint
  })
})

describe('downsamplePrivacySegments', () => {
  it('enforces the max point budget even when segments exceed the limit', () => {
    const segments = Array.from({ length: 10 }, (_, index) =>
      createSegment(index, 2)
    )

    const sampled = downsamplePrivacySegments(segments, 6)
    const totalPoints = sampled.reduce((sum, segment) => {
      return sum + segment.points.length
    }, 0)

    expect(totalPoints).toBeLessThanOrEqual(6)
  })

  it('drops extra segments when minimum per-kept-segment points is required', () => {
    const segments = Array.from({ length: 6 }, (_, index) =>
      createSegment(index, 2)
    )

    const sampled = downsamplePrivacySegments(segments, 5, {
      minimumPointsPerSegment: 2
    })
    const totalPoints = sampled.reduce((sum, segment) => {
      return sum + segment.points.length
    }, 0)

    expect(totalPoints).toBeLessThanOrEqual(5)
    expect(sampled.length).toBeLessThanOrEqual(2)
    expect(sampled.every((segment) => segment.points.length >= 2)).toBe(true)
  })
})

describe('getDistanceMeters', () => {
  it('returns finite distance for near-antipodal points', () => {
    const distance = getDistanceMeters(
      { lat: 0, lng: 0 },
      { lat: 0.0000001, lng: 180 }
    )

    expect(Number.isFinite(distance)).toBe(true)
    expect(distance).toBeGreaterThan(0)
  })
})

describe('getVisibleSegments', () => {
  it('returns only visible segments with at least two points', () => {
    const points = [
      { lat: 52, lng: 5 },
      { lat: 52.00001, lng: 5.00001 },
      { lat: 52.0002, lng: 5.0002 },
      { lat: 52.0003, lng: 5.0003 },
      { lat: 52, lng: 5 },
      { lat: 52.0002, lng: 5.0002 },
      { lat: 52.0003, lng: 5.0003 }
    ]

    const segments = getVisibleSegments(points, {
      lat: 52,
      lng: 5,
      radiusMeters: 5
    })

    expect(segments).toHaveLength(2)
    expect(segments[0]).toHaveLength(2)
    expect(segments[1]).toHaveLength(2)
    expect(segments.flat()).toEqual([
      { lat: 52.0002, lng: 5.0002 },
      { lat: 52.0003, lng: 5.0003 },
      { lat: 52.0002, lng: 5.0002 },
      { lat: 52.0003, lng: 5.0003 }
    ])
  })
})
