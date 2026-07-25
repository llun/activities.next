import {
  FITNESS_PRIVACY_RADIUS_OPTIONS,
  MAX_FITNESS_PRIVACY_RADIUS_METERS,
  downsamplePrivacySegments,
  getDistanceMeters,
  getFitnessPrivacyLocations,
  getVisibleSegments,
  sanitizePrivacyRadiusMeters
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
    // Offsets are sized against the 50m radius: ~1.3m from home is inside it,
    // ~261m and ~392m are well outside.
    const points = [
      { lat: 52, lng: 5 },
      { lat: 52.00001, lng: 5.00001 },
      { lat: 52.002, lng: 5.002 },
      { lat: 52.003, lng: 5.003 },
      { lat: 52, lng: 5 },
      { lat: 52.002, lng: 5.002 },
      { lat: 52.003, lng: 5.003 }
    ]

    const segments = getVisibleSegments(points, {
      lat: 52,
      lng: 5,
      radiusMeters: 50
    })

    expect(segments).toHaveLength(2)
    expect(segments[0]).toHaveLength(2)
    expect(segments[1]).toHaveLength(2)
    expect(segments.flat()).toEqual([
      { lat: 52.002, lng: 5.002 },
      { lat: 52.003, lng: 5.003 },
      { lat: 52.002, lng: 5.002 },
      { lat: 52.003, lng: 5.003 }
    ])
  })

  it('hides points that match any configured privacy location', () => {
    const points = [
      { lat: 52, lng: 5 },
      { lat: 52.00001, lng: 5.00001 },
      { lat: 52.5, lng: 5.5 },
      { lat: 52.50001, lng: 5.50001 },
      { lat: 53, lng: 6 },
      { lat: 53.00001, lng: 6.00001 }
    ]

    const segments = getVisibleSegments(points, [
      { lat: 52, lng: 5, radiusMeters: 50 },
      { lat: 52.5, lng: 5.5, radiusMeters: 50 }
    ])

    expect(segments).toHaveLength(1)
    expect(segments[0]).toEqual([
      { lat: 53, lng: 6 },
      { lat: 53.00001, lng: 6.00001 }
    ])
  })
})

describe('getFitnessPrivacyLocations', () => {
  it('returns normalized locations from the privacy locations list', () => {
    const locations = getFitnessPrivacyLocations({
      privacyLocations: [
        {
          latitude: 37.7749,
          longitude: -122.4194,
          hideRadiusMeters: 200
        },
        {
          latitude: 34.0522,
          longitude: -118.2437,
          hideRadiusMeters: 100
        }
      ]
    })

    expect(locations).toEqual([
      {
        lat: 37.7749,
        lng: -122.4194,
        radiusMeters: 200
      },
      {
        lat: 34.0522,
        lng: -118.2437,
        radiusMeters: 100
      }
    ])
  })

  it('falls back to legacy single-location fields when list is missing', () => {
    const locations = getFitnessPrivacyLocations({
      privacyHomeLatitude: 40.7128,
      privacyHomeLongitude: -74.006,
      privacyHideRadiusMeters: 50
    })

    expect(locations).toEqual([
      {
        lat: 40.7128,
        lng: -74.006,
        radiusMeters: 50
      }
    ])
  })

  it('snaps a radius saved under the older smaller option set up to 50m', () => {
    const locations = getFitnessPrivacyLocations({
      privacyLocations: [
        {
          latitude: 40.7128,
          longitude: -74.006,
          hideRadiusMeters: 20
        }
      ]
    })

    expect(locations).toEqual([
      {
        lat: 40.7128,
        lng: -74.006,
        radiusMeters: 50
      }
    ])
  })
})

describe('FITNESS_PRIVACY_RADIUS_OPTIONS', () => {
  it('offers 50m as the smallest enabled radius and 1km as the largest', () => {
    expect(FITNESS_PRIVACY_RADIUS_OPTIONS).toEqual([0, 50, 100, 200, 500, 1000])
  })

  it('stays sorted ascending, which the upward snap depends on', () => {
    const sorted = [...FITNESS_PRIVACY_RADIUS_OPTIONS].sort(
      (first, second) => first - second
    )

    expect([...FITNESS_PRIVACY_RADIUS_OPTIONS]).toEqual(sorted)
  })

  it('caps at the largest option, so a new option cannot outgrow the cap', () => {
    expect(MAX_FITNESS_PRIVACY_RADIUS_METERS).toBe(
      Math.max(...FITNESS_PRIVACY_RADIUS_OPTIONS)
    )
  })
})

describe('sanitizePrivacyRadiusMeters', () => {
  it.each([
    { description: 'keeps a supported radius', value: 200, expected: 200 },
    { description: 'keeps the disabled radius', value: 0, expected: 0 },
    { description: 'snaps a legacy 5m radius up', value: 5, expected: 50 },
    { description: 'snaps a legacy 20m radius up', value: 20, expected: 50 },
    { description: 'snaps an in-between radius up', value: 300, expected: 500 },
    { description: 'caps an oversized radius', value: 5000, expected: 1000 },
    { description: 'rejects a negative radius', value: -10, expected: 0 },
    { description: 'rejects a non-finite radius', value: NaN, expected: 0 },
    { description: 'rejects a non-numeric radius', value: '50', expected: 0 }
  ])(
    '$description',
    ({ value, expected }: { value: unknown; expected: number }) => {
      expect(sanitizePrivacyRadiusMeters(value)).toBe(expected)
    }
  )
})
