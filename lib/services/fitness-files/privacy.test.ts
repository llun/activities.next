import { downsamplePrivacySegments, getDistanceMeters } from './privacy'

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
