import {
  FITNESS_PRIVACY_RADIUS_OPTIONS,
  type FitnessPrivacyLocation,
  type FitnessPrivacyRadiusMeters,
  MAX_FITNESS_PRIVACY_RADIUS_METERS,
  annotatePointsWithPrivacy,
  buildPrivacySegments,
  downsamplePrivacySegments,
  getDistanceMeters,
  getFitnessPrivacyLocations,
  getPrivacyVisibleRange,
  getVisibleSegments,
  isPointInsideAnyPrivacyLocation,
  isPointInsidePrivacyLocation,
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

// Fixtures for the head/tail trim are laid out on a single north-south line
// through one origin, so a "metres from the origin" offset is simultaneously the
// straight-line distance from a zone centred there AND — for a monotonic run —
// the cumulative along-route distance. That keeps the arithmetic in each case
// readable instead of hidden behind decimal degrees. `getDistanceMeters` on a
// due-north pair is asserted below so the conversion cannot drift.
const ORIGIN = { lat: 52, lng: 5 }
const METERS_PER_DEGREE_LATITUDE = 111_194.92664455873

const pointAtMetersNorth = (meters: number) => ({
  lat: ORIGIN.lat + meters / METERS_PER_DEGREE_LATITUDE,
  lng: ORIGIN.lng
})

const routeAtMetersNorth = (offsets: number[]) =>
  offsets.map(pointAtMetersNorth)

const zoneAtMetersNorth = (
  meters: number,
  radiusMeters: FitnessPrivacyRadiusMeters
): FitnessPrivacyLocation => ({
  ...pointAtMetersNorth(meters),
  radiusMeters
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

  it('measures a due-north offset as the metres the fixture helper asked for', () => {
    expect(
      getDistanceMeters(pointAtMetersNorth(0), pointAtMetersNorth(250))
    ).toBeCloseTo(250, 6)
  })
})

describe('isPointInsidePrivacyLocation', () => {
  it.each([
    {
      description: 'counts a point at the centre as inside',
      offsetMeters: 0,
      expected: true
    },
    {
      description: 'counts a point just within the boundary as inside',
      offsetMeters: 99.9,
      expected: true
    },
    {
      description: 'counts a point just beyond the boundary as outside',
      offsetMeters: 100.1,
      expected: false
    }
  ])(
    '$description',
    ({
      offsetMeters,
      expected
    }: {
      offsetMeters: number
      expected: boolean
    }) => {
      expect(
        isPointInsidePrivacyLocation(
          pointAtMetersNorth(offsetMeters),
          zoneAtMetersNorth(0, 100)
        )
      ).toBe(expected)
    }
  )

  it('counts a point exactly on the boundary as inside', () => {
    // The comparison is `<=`, and a zero distance against a zero radius is the
    // one boundary a lat/lng projection expresses without floating-point slack.
    // It is also why `normalizePrivacyLocations` drops zero-radius zones: left
    // in, this point would read as "inside" a zone that hides nothing.
    const centre = pointAtMetersNorth(0)

    expect(
      isPointInsidePrivacyLocation(centre, { ...centre, radiusMeters: 0 })
    ).toBe(true)
  })

  it('treats a missing privacy location as covering nothing', () => {
    expect(isPointInsidePrivacyLocation(pointAtMetersNorth(0), null)).toBe(
      false
    )
  })
})

describe('isPointInsideAnyPrivacyLocation', () => {
  it('matches a point inside the second of several zones', () => {
    expect(
      isPointInsideAnyPrivacyLocation(pointAtMetersNorth(500), [
        zoneAtMetersNorth(0, 100),
        zoneAtMetersNorth(500, 100)
      ])
    ).toBe(true)
  })

  it.each([
    { description: 'returns false for an empty zone list', zones: [] },
    { description: 'returns false for a missing zone list', zones: null },
    {
      description: 'returns false for an undefined zone list',
      zones: undefined
    }
  ])(
    '$description',
    ({ zones }: { zones: FitnessPrivacyLocation[] | null | undefined }) => {
      expect(
        isPointInsideAnyPrivacyLocation(pointAtMetersNorth(0), zones)
      ).toBe(false)
    }
  )
})

describe('getPrivacyVisibleRange', () => {
  it.each([
    {
      description: 'returns the whole route when no zone is configured',
      offsets: [0, 100, 200],
      zones: [],
      expected: { firstVisibleIndex: 0, lastVisibleIndex: 2 }
    },
    {
      description: 'returns the whole route when neither end is inside a zone',
      // The middle point sits dead on the zone centre and is still returned:
      // a zone the route only passes through never trims anything.
      offsets: [0, 300, 600],
      zones: [zoneAtMetersNorth(300, 100)],
      expected: { firstVisibleIndex: 0, lastVisibleIndex: 2 }
    },
    {
      description: 'trims the head to the first point a hide length along',
      offsets: [0, 50, 150, 300, 600],
      zones: [zoneAtMetersNorth(0, 100)],
      expected: { firstVisibleIndex: 2, lastVisibleIndex: 4 }
    },
    {
      description: 'trims the tail symmetrically from the last point',
      offsets: [600, 300, 150, 50, 0],
      zones: [zoneAtMetersNorth(0, 100)],
      expected: { firstVisibleIndex: 0, lastVisibleIndex: 2 }
    },
    {
      description:
        'trims both ends when the route starts and finishes in a zone',
      offsets: [0, 300, 600, 300, 20],
      zones: [zoneAtMetersNorth(0, 100)],
      expected: { firstVisibleIndex: 1, lastVisibleIndex: 3 }
    },
    {
      description: 'keeps a mid-route pass back through the zone in the window',
      offsets: [0, 50, 300, 60, 300, 600],
      zones: [zoneAtMetersNorth(0, 100)],
      expected: { firstVisibleIndex: 2, lastVisibleIndex: 5 }
    },
    {
      description:
        'hides a point that has left the circle but not covered the hide length',
      // Starts 90m from the centre of a 100m zone, so index 1 and 2 are already
      // outside the circle while only 20m and 40m along the route. This is the
      // radius acting as a LENGTH rather than only as an area.
      offsets: [90, 110, 130, 200],
      zones: [zoneAtMetersNorth(0, 100)],
      expected: { firstVisibleIndex: 3, lastVisibleIndex: 3 }
    },
    {
      description:
        'measures the hide length along the route, not from the anchor',
      // The one case that separates the two readings, so the accumulator cannot
      // be "simplified" into a straight line from the anchor without a failure.
      // Anchor 90m from a 100m centre; index 1 doubles back to 10m. Cumulative:
      // 80m at index 1 (inside anyway), then 180m at index 2 whose point is
      // 110m out, so index 2 qualifies. Crow-flies from the anchor: index 2 is
      // only 20m away, so it would be skipped and the range would be {3, 3}.
      offsets: [90, 10, 110, 300],
      zones: [zoneAtMetersNorth(0, 100)],
      expected: { firstVisibleIndex: 2, lastVisibleIndex: 3 }
    },
    {
      description: 'skips a candidate far enough along but inside another zone',
      offsets: [0, 60, 300, 500, 800],
      zones: [zoneAtMetersNorth(0, 100), zoneAtMetersNorth(300, 100)],
      expected: { firstVisibleIndex: 3, lastVisibleIndex: 4 }
    },
    {
      description: 'uses the largest radius among zones containing the start',
      // Radii chosen so largest and summed disagree: max 200 clears at index 2
      // (250m travelled, point 250m out), summing to 300 would clear at index 3.
      offsets: [0, 150, 250, 400],
      zones: [zoneAtMetersNorth(0, 100), zoneAtMetersNorth(0, 200)],
      expected: { firstVisibleIndex: 2, lastVisibleIndex: 3 }
    },
    {
      description: 'treats a zero-radius zone as no zone at all',
      // The zero-radius zone is parked on index 2, the first point that would
      // otherwise clear the 100m zone. Unfiltered it would read as "inside"
      // (distance 0 <= 0) and index 2 would be skipped for a zone that hides
      // nothing. Naming it in the anchor position instead proves nothing: there
      // a zero radius already falls out via `hideLengthMeters <= 0`.
      offsets: [0, 50, 150, 300],
      zones: [zoneAtMetersNorth(0, 100), zoneAtMetersNorth(150, 0)],
      expected: { firstVisibleIndex: 2, lastVisibleIndex: 3 }
    },
    {
      description:
        'returns the single index for a lone point outside every zone',
      offsets: [500],
      zones: [zoneAtMetersNorth(0, 100)],
      expected: { firstVisibleIndex: 0, lastVisibleIndex: 0 }
    },
    {
      description: 'returns null for an empty point list',
      offsets: [],
      zones: [zoneAtMetersNorth(0, 100)],
      expected: null
    },
    {
      description: 'returns null for a lone point inside a zone',
      offsets: [0],
      zones: [zoneAtMetersNorth(0, 100)],
      expected: null
    },
    {
      description: 'returns null when every point is inside a zone',
      offsets: [0, 100, 200],
      zones: [zoneAtMetersNorth(0, 1000)],
      expected: null
    },
    {
      description:
        'returns null when the route leaves the circle but never covers the hide length',
      // Indices 1 and 3 are outside the 100m circle, so the old per-point rule
      // showed them. The route only ever travels 21m, so now it shows nothing.
      offsets: [95, 105, 98, 102],
      zones: [zoneAtMetersNorth(0, 100)],
      expected: null
    },
    {
      description: 'returns null for a stationary trace that never accumulates',
      offsets: [0, 0, 0, 0],
      zones: [zoneAtMetersNorth(0, 100)],
      expected: null
    },
    {
      description: 'returns null when only the tail scan fails to find a point',
      // The one case that reaches the `lastVisibleIndex === null` guard: every
      // other null returns because the HEAD scan failed and short-circuited
      // first. Start is 1100m out so it is outside the 1000m zone, giving
      // R_start = 0 and firstVisibleIndex = 0; the finish at 500m is inside, so
      // R_end = 1000, and walking back accumulates only 300m then 600m.
      offsets: [1100, 800, 500],
      zones: [zoneAtMetersNorth(0, 1000)],
      expected: null
    }
  ])(
    '$description',
    ({
      offsets,
      zones,
      expected
    }: {
      offsets: number[]
      zones: FitnessPrivacyLocation[]
      expected: { firstVisibleIndex: number; lastVisibleIndex: number } | null
    }) => {
      expect(
        getPrivacyVisibleRange(routeAtMetersNorth(offsets), zones)
      ).toEqual(expected)
    }
  )

  it('returns null when the head and tail trims cross', () => {
    // Both ends sit just inside the edge of a 1km zone whose centre is ~1km
    // away, on a 1.4km out-and-back. Each scan finds a candidate, but on the
    // far side of the other's — so the route is shorter than the two trims it
    // owes and nothing survives.
    const points = routeAtMetersNorth([990, 1200, 1500, 1700, 1500, 1200, 990])

    expect(
      getPrivacyVisibleRange(points, [zoneAtMetersNorth(0, 1000)])
    ).toBeNull()
  })

  it('accepts a single privacy location as well as a list', () => {
    const points = routeAtMetersNorth([0, 50, 150, 300])

    expect(getPrivacyVisibleRange(points, zoneAtMetersNorth(0, 100))).toEqual({
      firstVisibleIndex: 2,
      lastVisibleIndex: 3
    })
  })
})

describe('annotatePointsWithPrivacy', () => {
  it('marks one unbroken visible run for a route that re-enters a zone', () => {
    const points = routeAtMetersNorth([0, 50, 300, 60, 300, 600, 40])

    const annotated = annotatePointsWithPrivacy(points, [
      zoneAtMetersNorth(0, 100)
    ])

    // Head trimmed, tail trimmed, and the index-3 dip back to 60m from the
    // centre stays visible rather than punching a hole in the middle.
    expect(annotated.map((point) => point.isHiddenByPrivacy)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      true
    ])
  })

  it('marks every point hidden when no part of the route may be shown', () => {
    const annotated = annotatePointsWithPrivacy(
      routeAtMetersNorth([0, 100, 200]),
      [zoneAtMetersNorth(0, 1000)]
    )

    expect(annotated.every((point) => point.isHiddenByPrivacy)).toBe(true)
  })

  it('marks nothing hidden without a privacy location', () => {
    const annotated = annotatePointsWithPrivacy(
      routeAtMetersNorth([0, 100, 200]),
      null
    )

    expect(annotated.every((point) => point.isHiddenByPrivacy)).toBe(false)
  })

  it('preserves the other properties of each point', () => {
    const annotated = annotatePointsWithPrivacy(
      [{ ...pointAtMetersNorth(0), elapsedSeconds: 12 }],
      null
    )

    expect(annotated[0]).toMatchObject({ elapsedSeconds: 12 })
  })
})

describe('buildPrivacySegments', () => {
  it('produces at most a hidden head, one visible run, and a hidden tail', () => {
    // Dips back inside the zone three times mid-route. Under the old per-point
    // rule this produced nine segments.
    const annotated = annotatePointsWithPrivacy(
      routeAtMetersNorth([0, 50, 300, 60, 300, 40, 300, 70, 300, 30]),
      [zoneAtMetersNorth(0, 100)]
    )

    expect(
      buildPrivacySegments(annotated).map(
        (segment) => segment.isHiddenByPrivacy
      )
    ).toEqual([true, false, true])
  })
})

describe('getVisibleSegments', () => {
  it('returns one unbroken segment for a route that re-enters a privacy zone', () => {
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

    expect(segments).toHaveLength(1)
    expect(segments[0]).toEqual([
      { lat: 52.002, lng: 5.002 },
      { lat: 52.003, lng: 5.003 },
      // The mid-route return to the zone centre. Shown on purpose: a gap here
      // would advertise the centre more precisely than the line does.
      { lat: 52, lng: 5 },
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

  it('returns no segments when no part of the route may be shown', () => {
    expect(
      getVisibleSegments(routeAtMetersNorth([0, 100, 200]), [
        zoneAtMetersNorth(0, 1000)
      ])
    ).toEqual([])
  })

  it('returns no segments when the trim leaves a single point', () => {
    expect(
      getVisibleSegments(routeAtMetersNorth([90, 110, 130, 200]), [
        zoneAtMetersNorth(0, 100)
      ])
    ).toEqual([])
  })

  it('returns the caller point objects without adding a privacy flag', () => {
    // Both map jobs deep-compare these against the parsed coordinates, so an
    // extra key here is a behaviour change, not a detail.
    const segments = getVisibleSegments(routeAtMetersNorth([0, 150, 300]), [
      zoneAtMetersNorth(0, 100)
    ])

    expect(Object.keys(segments[0][0])).toEqual(['lat', 'lng'])
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
