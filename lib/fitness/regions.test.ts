import {
  HeatmapRegion,
  MAX_HEATMAP_REGIONS,
  RectRegion,
  deserializeRegions,
  formatRectRegion,
  getRegionBounds,
  isOrientedRect,
  isRectInRange,
  isSerializableRect,
  isValidRect,
  serializeRegion,
  serializeRegions
} from '@/lib/fitness/regions'

const rect = (
  nwLat: number,
  nwLng: number,
  seLat: number,
  seLng: number,
  name?: string
): RectRegion => ({
  type: 'rect',
  name,
  nw: { lat: nwLat, lng: nwLng },
  se: { lat: seLat, lng: seLng }
})

describe('serializeRegion', () => {
  it('serializes the whole world to the world-wide sentinel', () => {
    expect(serializeRegion({ type: 'world' })).toBe('')
  })

  it('serializes a single rectangle to its lone token', () => {
    expect(serializeRegion(rect(52.6, 5.6, 52, 6.2))).toBe(
      'rect:52.60,5.60,52.00,6.20'
    )
  })
})

describe('serializeRegions', () => {
  it('serializes the whole world (and the empty list) to the world-wide sentinel', () => {
    expect(serializeRegions([{ type: 'world' }])).toBe('')
    expect(serializeRegions([])).toBe('')
  })

  it('collapses any list containing a world region to the world-wide sentinel', () => {
    expect(serializeRegions([rect(52, 5, 51, 6), { type: 'world' }])).toBe('')
  })

  it('serializes a rectangle to a fixed-precision rect token', () => {
    expect(serializeRegions([rect(52.6, 5.6, 52, 6.2)])).toBe(
      'rect:52.60,5.60,52.00,6.20'
    )
  })

  it('sorts and deduplicates rectangle tokens for a stable cache key', () => {
    const a = rect(53, 3, 52, 4)
    const b = rect(52, 5, 51, 6)
    expect(serializeRegions([a, b, a])).toBe(
      'rect:52.00,5.00,51.00,6.00;rect:53.00,3.00,52.00,4.00'
    )
  })

  it('drops degenerate rectangles (top-left not north-west of bottom-right)', () => {
    // se is north-east of nw — invalid.
    expect(serializeRegions([rect(50, 6, 52, 4)])).toBe('')
  })

  it.each([
    {
      description: 'thinner than the precision in latitude',
      region: [52.002, 5.0, 52.001, 6.0]
    },
    {
      description: 'thinner than the precision in longitude',
      region: [53.0, 5.001, 52.0, 5.002]
    },
    {
      description: 'thinner than the precision in both',
      region: [52.002, 5.001, 52.001, 5.002]
    },
    // The three above collapse both of an axis's edges onto a SHARED value, so
    // they leave two of roundTripRect's four coordinates unpinned. These two
    // straddle a rounding midpoint on one axis at a time, so each fails unless
    // BOTH of that axis's corners are rounded.
    {
      description: 'collapsing across a rounding midpoint in latitude only',
      region: [52.004, 5.0, 51.996, 6.0]
    },
    {
      description: 'collapsing across a rounding midpoint in longitude only',
      region: [53.0, 4.996, 52.0, 5.004]
    }
  ])('drops a rectangle $description', ({ region }) => {
    // Such a box is valid before rounding and degenerate after it. Emitting the
    // rounded token anyway produced a region string that reads as a small
    // rectangle and deserializes to nothing — which every consumer takes as
    // WORLD scope, so the generation job built the actor's whole unclipped
    // history under it while the share page titled it "Map area" and never said
    // world. The honest answer is the world sentinel.
    const [nwLat, nwLng, seLat, seLng] = region
    const serialized = serializeRegions([rect(nwLat, nwLng, seLat, seLng)])
    expect(serialized).toBe('')
    expect(getRegionBounds(deserializeRegions(serialized))).toEqual([])
  })

  it('keeps a rectangle exactly one precision step wide', () => {
    // The boundary of the rule above: 0.01° survives rounding on both axes.
    expect(serializeRegions([rect(52.01, 5.0, 52.0, 5.01)])).toBe(
      'rect:52.01,5.00,52.00,5.01'
    )
  })

  it.each([
    { description: 'a latitude past the pole', region: [90.004, 5, 0, 6] },
    {
      description: 'a latitude past the south pole',
      region: [0, 5, -90.004, 6]
    },
    {
      description: 'a longitude past the antimeridian',
      region: [52, -180.004, 51, 6]
    },
    { description: 'a longitude past +180', region: [52, 5, 51, 180.004] }
  ])(
    'drops a rectangle with $description rather than rounding it into range',
    ({ region }) => {
      // Rounding pulls such a coordinate back inside the valid range, so checking
      // only the rounded box would ADMIT a scope that serializes to the world
      // sentinel today — moving its cache key and orphaning the heatmap already
      // stored under it. The rule may only ever drop a rectangle.
      const [nwLat, nwLng, seLat, seLng] = region
      expect(serializeRegions([rect(nwLat, nwLng, seLat, seLng)])).toBe('')
    }
  )

  it('never emits a token that deserializes to nothing', () => {
    // The invariant the two cases above are instances of: whatever comes out of
    // serializeRegions must read back as the same scope. A non-empty string
    // that resolves to no bounds is indistinguishable from the world.
    const edges = [
      0, 90, -90, 180, -180, 89.999, 179.999, 52.005, 0.004, 0.005, 0.006, 1e-7
    ]
    const candidates: RectRegion[][] = [
      [rect(52.002, 5.001, 52.001, 5.002)],
      [rect(52.6, 5.6, 52.0, 6.2)],
      [rect(52.004, 5.0, 52.0, 5.004)],
      [rect(0.001, 0.001, -0.001, 0.002)],
      [rect(52.002, 5.001, 52.001, 5.002), rect(53, 3, 52, 4)],
      ...edges.flatMap((a) =>
        edges.map((b): RectRegion[] => [rect(a, b, b, a)])
      ),
      // Boxes straddling the precision step in one axis at a time.
      ...Array.from({ length: 40 }, (_unused, index): RectRegion[] => [
        rect(50 + (index + 1) * 0.0005, 5, 50, 5 + (index + 1) * 0.0005)
      ])
    ]
    for (const regions of candidates) {
      const serialized = serializeRegions(regions)
      if (serialized === '') continue
      expect(getRegionBounds(deserializeRegions(serialized))).not.toEqual([])
    }
  })

  it('ignores the optional name when serializing', () => {
    expect(serializeRegions([rect(52, 5, 51, 6, 'Veluwe loop')])).toBe(
      serializeRegions([rect(52, 5, 51, 6)])
    )
  })

  it('caps the output at MAX_HEATMAP_REGIONS so it fits the varchar(255) column', () => {
    // 12 widest distinct rectangles; without the cap their canonical tokens
    // would overflow 255 chars (12 * 34 + 11 = 419).
    const many: RectRegion[] = Array.from({ length: 12 }, (_unused, index) =>
      rect(-89.99 + index * 0.01, -180, -90, -179.99 + index * 0.01)
    )
    const serialized = serializeRegions(many)
    expect(serialized.length).toBeLessThanOrEqual(255)
    expect(serialized.split(';')).toHaveLength(MAX_HEATMAP_REGIONS)
  })
})

describe('deserializeRegions', () => {
  it('maps the world-wide sentinel back to a single whole-world region', () => {
    expect(deserializeRegions('')).toEqual([{ type: 'world' }])
    expect(deserializeRegions('   ')).toEqual([{ type: 'world' }])
  })

  it('parses rect tokens into rectangle regions', () => {
    expect(deserializeRegions('rect:52.60,5.60,52.00,6.20')).toEqual([
      rect(52.6, 5.6, 52, 6.2)
    ])
  })

  it('collapses a list containing the world token to a single whole-world region', () => {
    expect(deserializeRegions('rect:52.00,5.00,51.00,6.00;world')).toEqual([
      { type: 'world' }
    ])
  })

  it('drops malformed or out-of-range tokens', () => {
    expect(deserializeRegions('garbage;rect:not,a,number,here')).toEqual([])
    expect(deserializeRegions('rect:200.00,5.00,51.00,6.00')).toEqual([])
  })

  it('rejects rect tokens with empty/whitespace coordinates (no 0 coercion)', () => {
    // Number('') === 0 would otherwise parse a longitude of 0 here.
    expect(deserializeRegions('rect:52.00,,51.00,6.00')).toEqual([])
    expect(deserializeRegions('rect:52.00, ,51.00,6.00')).toEqual([])
    expect(deserializeRegions('rect:52.00,5.00,51.00')).toEqual([])
  })

  it.each([
    {
      description: 'whole world',
      regions: [{ type: 'world' }] as HeatmapRegion[]
    },
    {
      description: 'single rectangle',
      regions: [rect(52.6, 5.6, 52, 6.2)] as HeatmapRegion[]
    },
    {
      description: 'multiple rectangles',
      regions: [rect(53, 3, 52, 4), rect(52, 5, 51, 6)] as HeatmapRegion[]
    }
  ])(
    'round-trips $description through serialize → deserialize',
    ({ regions }) => {
      const reparsed = deserializeRegions(serializeRegions(regions))
      expect(serializeRegions(reparsed)).toBe(serializeRegions(regions))
    }
  )
})

describe('getRegionBounds', () => {
  it('returns no bounds (no clipping) for the whole world or an empty list', () => {
    expect(getRegionBounds([{ type: 'world' }])).toEqual([])
    expect(getRegionBounds([])).toEqual([])
  })

  it('maps each rectangle to its min/max bounding box', () => {
    expect(getRegionBounds([rect(52.6, 5.6, 52, 6.2)])).toEqual([
      { minLat: 52, maxLat: 52.6, minLng: 5.6, maxLng: 6.2 }
    ])
  })

  it('returns no bounds when a world region is present among rectangles', () => {
    expect(getRegionBounds([rect(52, 5, 51, 6), { type: 'world' }])).toEqual([])
  })
})

describe('isRectInRange', () => {
  it.each([
    { description: 'an ordinary box', region: [52, 5, 51, 6], expected: true },
    {
      description: 'the whole globe',
      region: [90, -180, -90, 180],
      expected: true
    },
    // What a map panned onto the next copy of the world hands back.
    {
      description: 'an unwrapped longitude',
      region: [52.5, 362, 52, 363],
      expected: false
    },
    {
      description: 'a latitude past the pole',
      region: [90.01, 5, 51, 6],
      expected: false
    },
    {
      description: 'a longitude past +180',
      region: [52, 5, 51, 180.01],
      expected: false
    },
    {
      description: 'a NaN corner',
      region: [52, Number.NaN, 51, 6],
      expected: false
    }
  ])('answers $expected for $description', ({ region, expected }) => {
    const [nwLat, nwLng, seLat, seLng] = region
    expect(isRectInRange(rect(nwLat, nwLng, seLat, seLng))).toBe(expected)
  })
})

describe('isOrientedRect', () => {
  it.each([
    { description: 'a normal box', region: [52, 5, 51, 6], expected: true },
    // The whole point: a collapsed box is ORIENTED but not valid, which is what
    // lets a surface tell "too small" apart from "wrong way round".
    {
      description: 'a fully collapsed box',
      region: [52, 5, 52, 5],
      expected: true
    },
    {
      description: 'a box collapsed in latitude',
      region: [52, 5, 52, 6],
      expected: true
    },
    {
      description: 'a box collapsed in longitude',
      region: [52, 5, 51, 5],
      expected: true
    },
    { description: 'an inverted box', region: [51, 6, 52, 5], expected: false },
    {
      description: 'a box inverted in latitude only',
      region: [51, 5, 52, 6],
      expected: false
    },
    {
      description: 'a box inverted in longitude only',
      region: [52, 6, 51, 5],
      expected: false
    },
    {
      description: 'an out-of-range box',
      region: [52.5, 362, 52, 363],
      expected: false
    }
  ])('answers $expected for $description', ({ region, expected }) => {
    const [nwLat, nwLng, seLat, seLng] = region
    expect(isOrientedRect(rect(nwLat, nwLng, seLat, seLng))).toBe(expected)
  })
})

describe('isSerializableRect', () => {
  it.each([
    {
      description: 'a box a full step wide',
      region: [52.01, 5, 52, 5.01],
      expected: true
    },
    {
      description: 'a box thinner than the step',
      region: [52.002, 5, 52.001, 6],
      expected: false
    },
    {
      description: 'a box collapsed across a midpoint',
      region: [52.004, 5, 51.996, 6],
      expected: false
    },
    {
      description: 'an out-of-range box rounding would rescue',
      region: [90.004, 5, 51, 6],
      expected: false
    },
    { description: 'an inverted box', region: [51, 6, 52, 5], expected: false }
  ])('answers $expected for $description', ({ region, expected }) => {
    const [nwLat, nwLng, seLat, seLng] = region
    expect(isSerializableRect(rect(nwLat, nwLng, seLat, seLng))).toBe(expected)
  })

  it('agrees with what serializeRegions actually emits', () => {
    // The invariant the composer relies on: a rect the gate accepts serializes
    // to a token, and one it rejects serializes to the world sentinel.
    const cases: RectRegion[] = [
      rect(52, 5, 51, 6),
      rect(52.01, 5, 52, 5.01),
      rect(52.002, 5, 52.001, 6),
      rect(52.004, 5, 51.996, 6),
      rect(90.004, 5, 51, 6),
      rect(51, 6, 52, 5)
    ]
    for (const region of cases) {
      expect(serializeRegions([region]) !== '').toBe(isSerializableRect(region))
    }
  })
})

describe('isValidRect', () => {
  it('accepts a non-degenerate in-range rectangle', () => {
    expect(isValidRect(rect(52, 5, 51, 6))).toBe(true)
  })

  it.each([
    { description: 'inverted latitude', region: rect(51, 5, 52, 6) },
    { description: 'inverted longitude', region: rect(52, 6, 51, 5) },
    { description: 'latitude out of range', region: rect(95, 5, 51, 6) },
    { description: 'NaN corner', region: rect(NaN, 5, 51, 6) },
    { description: 'Infinity corner', region: rect(52, 5, 51, Infinity) }
  ])('rejects a rectangle with $description', ({ region }) => {
    expect(isValidRect(region)).toBe(false)
  })

  it('serializes a non-finite rectangle to the world-wide sentinel', () => {
    expect(serializeRegions([rect(NaN, 5, 51, 6)])).toBe('')
  })
})

describe('formatRectRegion', () => {
  it('formats a rectangle as a TL → BR coordinate readout', () => {
    expect(formatRectRegion(rect(52.6, 5.6, 52, 6.2))).toBe(
      'TL 52.60°N 5.60°E → BR 52.00°N 6.20°E'
    )
  })

  it('uses S/W hemispheres for negative coordinates', () => {
    expect(formatRectRegion(rect(-10, -20, -15, -5))).toBe(
      'TL 10.00°S 20.00°W → BR 15.00°S 5.00°W'
    )
  })
})
