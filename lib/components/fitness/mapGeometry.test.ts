import {
  boxFromPoints,
  boxToPolygon,
  buildRouteGeoJson,
  computeFocusBounds,
  downsampleSegments,
  round2
} from './mapGeometry'

// A denser route cluster ~100° of longitude away from the Amsterdam fixture, so a
// whole-world cache containing both spans the globe. computeFocusBounds tightens
// the initial view to this (denser) cluster instead of the global extent.
const SINGAPORE_CLUSTER_POINTS = [
  { lat: 1.3, lng: 103.7 },
  { lat: 1.32, lng: 103.75 },
  { lat: 1.35, lng: 103.8 },
  { lat: 1.37, lng: 103.85 },
  { lat: 1.4, lng: 103.9 },
  { lat: 1.33, lng: 103.78 }
]
const SINGAPORE_CLUSTER_BOUNDS = {
  minLat: 1.3,
  maxLat: 1.4,
  minLng: 103.7,
  maxLng: 103.9
}

describe('buildRouteGeoJson', () => {
  it('maps segments to lng/lat LineString features', () => {
    const geoJson = buildRouteGeoJson([
      {
        points: [
          { lat: 52.36, lng: 4.88 },
          { lat: 52.39, lng: 4.91 }
        ]
      }
    ])

    expect(geoJson).toEqual({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { isHiddenByPrivacy: false },
          geometry: {
            type: 'LineString',
            coordinates: [
              [4.88, 52.36],
              [4.91, 52.39]
            ]
          }
        }
      ]
    })
  })

  it('drops segments with fewer than two points and keeps the privacy flag', () => {
    const geoJson = buildRouteGeoJson([
      { points: [{ lat: 1, lng: 2 }] },
      {
        isHiddenByPrivacy: true,
        points: [
          { lat: 1, lng: 2 },
          { lat: 3, lng: 4 }
        ]
      }
    ])

    expect(geoJson.features).toHaveLength(1)
    expect(geoJson.features[0].properties).toEqual({ isHiddenByPrivacy: true })
  })
})

describe('downsampleSegments', () => {
  it('thins oversized geometry while preserving each segment’s endpoints', () => {
    const longSegment = {
      points: Array.from({ length: 12 }, (_, index) => ({
        lat: index,
        lng: index
      }))
    }
    const shortSegment = {
      points: [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 }
      ]
    }

    const result = downsampleSegments([longSegment, shortSegment], 6)
    const [thinned, untouched] = result

    // No segment is dropped — the route count is preserved.
    expect(result).toHaveLength(2)
    expect(thinned.points.length).toBeLessThan(longSegment.points.length)
    expect(thinned.points[0]).toEqual(longSegment.points[0])
    expect(thinned.points[thinned.points.length - 1]).toEqual(
      longSegment.points[longSegment.points.length - 1]
    )
    // Segments with two or fewer points are left exactly as-is.
    expect(untouched).toBe(shortSegment)
  })

  it('returns the original segments unchanged when under the budget', () => {
    const segments = [
      {
        points: [
          { lat: 0, lng: 0 },
          { lat: 1, lng: 1 },
          { lat: 2, lng: 2 }
        ]
      }
    ]

    expect(downsampleSegments(segments, 100)).toBe(segments)
  })
})

describe('computeFocusBounds', () => {
  it('keeps the full bounds for a single contiguous region', () => {
    const bounds = { minLat: 52.36, maxLat: 52.39, minLng: 4.88, maxLng: 4.91 }
    const result = computeFocusBounds(
      [
        {
          points: [
            { lat: 52.36, lng: 4.88 },
            { lat: 52.39, lng: 4.91 }
          ]
        }
      ],
      bounds
    )

    expect(result.focused).toBe(false)
    expect(result.bounds).toBe(bounds)
  })

  it('keeps the full bounds for a region spanning several adjacent cells', () => {
    // Points spread contiguously across ~8° of longitude (several 5° cells that
    // are 8-connected), so there is a single cluster — show the whole extent.
    const bounds = { minLat: 50, maxLat: 52, minLng: 4, maxLng: 12 }
    const result = computeFocusBounds(
      [
        {
          points: [
            { lat: 50, lng: 4 },
            { lat: 51, lng: 8 },
            { lat: 52, lng: 12 }
          ]
        }
      ],
      bounds
    )

    expect(result.focused).toBe(false)
    expect(result.bounds).toBe(bounds)
  })

  it('tightens to the densest cluster for disjoint regions', () => {
    const bounds = { minLat: 1.3, maxLat: 52.39, minLng: 4.88, maxLng: 103.9 }
    const result = computeFocusBounds(
      [
        {
          points: [
            { lat: 52.36, lng: 4.88 },
            { lat: 52.39, lng: 4.91 }
          ]
        },
        { points: SINGAPORE_CLUSTER_POINTS }
      ],
      bounds
    )

    expect(result.focused).toBe(true)
    expect(result.bounds).toEqual(SINGAPORE_CLUSTER_BOUNDS)
  })

  it('ignores a sparse far-away outlier and frames the main cluster', () => {
    const bounds = { minLat: 52.36, maxLat: 52.39, minLng: 4.88, maxLng: 40 }
    const result = computeFocusBounds(
      [
        {
          points: [
            { lat: 52.36, lng: 4.88 },
            { lat: 52.37, lng: 4.89 },
            { lat: 52.39, lng: 4.91 }
          ]
        },
        // A single stray point far east in its own, disconnected cell.
        { points: [{ lat: 52.36, lng: 40 }] }
      ],
      bounds
    )

    expect(result.focused).toBe(true)
    expect(result.bounds).toEqual({
      minLat: 52.36,
      maxLat: 52.39,
      minLng: 4.88,
      maxLng: 4.91
    })
  })

  it('returns the full bounds for an empty segment list', () => {
    const bounds = { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 }
    const result = computeFocusBounds([], bounds)

    expect(result.focused).toBe(false)
    expect(result.bounds).toBe(bounds)
  })

  it('skips non-finite vertices so they create no spurious cluster', () => {
    const bounds = { minLat: 52.36, maxLat: 52.39, minLng: 4.88, maxLng: 4.91 }
    const result = computeFocusBounds(
      [
        {
          points: [
            { lat: 52.36, lng: 4.88 },
            { lat: 52.39, lng: 4.91 }
          ]
        },
        // An entirely non-finite segment must contribute no grid cell; otherwise
        // it would look like a second region and flip the result to focused.
        {
          points: [
            { lat: NaN, lng: NaN },
            { lat: Infinity, lng: -Infinity }
          ]
        }
      ],
      bounds
    )

    expect(result.focused).toBe(false)
    expect(result.bounds).toBe(bounds)
  })

  it('ignores non-finite vertices when framing a focused cluster', () => {
    const bounds = { minLat: 1.3, maxLat: 52.39, minLng: 4.88, maxLng: 103.9 }
    const result = computeFocusBounds(
      [
        {
          points: [
            { lat: 52.36, lng: 4.88 },
            { lat: 52.37, lng: 4.89 },
            { lat: 52.39, lng: 4.91 }
          ]
        },
        // The denser cluster carries a stray non-finite vertex that must not
        // widen (or NaN-poison) the focused box.
        { points: [{ lat: NaN, lng: 103.8 }, ...SINGAPORE_CLUSTER_POINTS] }
      ],
      bounds
    )

    expect(result.focused).toBe(true)
    expect(result.bounds).toEqual(SINGAPORE_CLUSTER_BOUNDS)
  })

  it('does not merge clusters straddling the antimeridian (documented limitation)', () => {
    // Two clusters at opposite signs near ±180° lon fall in non-adjacent grid
    // cells, so the focus frames only the denser one rather than spanning the
    // shorter way around the globe.
    const bounds = { minLat: 0, maxLat: 1, minLng: -179.9, maxLng: 179.9 }
    const result = computeFocusBounds(
      [
        {
          points: [
            { lat: 0.5, lng: 179.5 },
            { lat: 0.6, lng: 179.7 },
            { lat: 0.55, lng: 179.9 }
          ]
        },
        { points: [{ lat: 0.5, lng: -179.9 }] }
      ],
      bounds
    )

    expect(result.focused).toBe(true)
    expect(result.bounds).toEqual({
      minLat: 0.5,
      maxLat: 0.6,
      minLng: 179.5,
      maxLng: 179.9
    })
  })

  it('merges cells that touch only diagonally (8-connectivity)', () => {
    const bounds = { minLat: 52, maxLat: 55, minLng: 4, maxLng: 8 }
    // The two 5° cells (0:10 and 1:11) are diagonal neighbours — connected only
    // at a corner. 8-connectivity merges them into one contiguous cluster, so
    // the full bounds are kept (a 4-connected flood fill would NOT merge these).
    const result = computeFocusBounds(
      [
        {
          points: [
            { lat: 52, lng: 4 },
            { lat: 55, lng: 8 }
          ]
        }
      ],
      bounds
    )

    expect(result.focused).toBe(false)
    expect(result.bounds).toBe(bounds)
  })

  it('does not merge cells a knight’s-move apart, focusing the densest cell', () => {
    const bounds = { minLat: 52, maxLat: 55, minLng: 4, maxLng: 13 }
    // Cell 0:10 (two points) is strictly denser than cell 2:11 (one point), and
    // the two cells are a knight's move apart (dx=2), so they stay separate — this
    // pins that grid adjacency (not mere proximity) is what merges clusters, and
    // that the seed is chosen by density rather than Map insertion order.
    const result = computeFocusBounds(
      [
        {
          points: [
            { lat: 52, lng: 4 },
            { lat: 53, lng: 4 },
            { lat: 55, lng: 13 }
          ]
        }
      ],
      bounds
    )

    expect(result.focused).toBe(true)
    expect(result.bounds).toEqual({
      minLat: 52,
      maxLat: 53,
      minLng: 4,
      maxLng: 4
    })
  })

  it('frames the densest cell even when another cluster has more cells', () => {
    // Cluster A spans two 8-adjacent cells (0:0 and 0:1) of one point each — the
    // largest connected cluster by cell count. Cluster B is a single isolated cell
    // (8:0) holding three points — the densest cell. The focus must frame B (seed
    // = densest cell, then its cluster), proving the helper does not instead pick
    // the cluster with the most cells.
    const bounds = { minLat: 0, maxLat: 7, minLng: 2, maxLng: 40.2 }
    const result = computeFocusBounds(
      [
        {
          points: [
            { lat: 2, lng: 2 },
            { lat: 7, lng: 2 }
          ]
        },
        {
          points: [
            { lat: 0, lng: 40 },
            { lat: 0.1, lng: 40.1 },
            { lat: 0.2, lng: 40.2 }
          ]
        }
      ],
      bounds
    )

    expect(result.focused).toBe(true)
    expect(result.bounds).toEqual({
      minLat: 0,
      maxLat: 0.2,
      minLng: 40,
      maxLng: 40.2
    })
  })
})

describe('round2', () => {
  it.each([
    {
      description: 'rounds down below the half',
      value: 1.2349,
      expected: 1.23
    },
    { description: 'rounds up above the half', value: 1.2351, expected: 1.24 },
    { description: 'keeps whole numbers whole', value: 52, expected: 52 },
    {
      description: 'rounds negative values',
      value: -70.0561,
      expected: -70.06
    },
    { description: 'drops trailing zeros', value: 4.9, expected: 4.9 }
  ])('$description', ({ value, expected }) => {
    expect(round2(value)).toBe(expected)
  })
})

describe('boxFromPoints', () => {
  it('normalizes any two corners to nw (top-left) and se (bottom-right)', () => {
    expect(boxFromPoints({ lat: 5, lng: 25 }, { lat: 10, lng: 20 })).toEqual({
      nw: { lat: 10, lng: 20 },
      se: { lat: 5, lng: 25 }
    })
  })

  it('rounds every coordinate to two decimal places', () => {
    expect(
      boxFromPoints(
        { lat: 40.049999, lng: -70.050001 },
        { lat: 39.950001, lng: -69.949999 }
      )
    ).toEqual({
      nw: { lat: 40.05, lng: -70.05 },
      se: { lat: 39.95, lng: -69.95 }
    })
  })
})

describe('boxToPolygon', () => {
  it('emits a closed ring in lng/lat order', () => {
    expect(
      boxToPolygon({ nw: { lat: 20, lng: 10 }, se: { lat: 18, lng: 14 } })
    ).toEqual({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [10, 20],
            [14, 20],
            [14, 18],
            [10, 18],
            [10, 20]
          ]
        ]
      }
    })
  })
})
