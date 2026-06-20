import {
  HeatmapRegion,
  MAX_HEATMAP_REGIONS,
  RectRegion,
  describeRegions,
  deserializeRegions,
  formatRectRegion,
  getRegionBounds,
  isValidRect,
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

describe('describeRegions', () => {
  it.each([
    {
      description: 'world-wide sentinel',
      serialized: '',
      expected: 'Whole world'
    },
    {
      description: 'single rectangle',
      serialized: 'rect:52.60,5.60,52.00,6.20',
      expected: '1 map area'
    },
    {
      description: 'two rectangles',
      serialized: 'rect:52.00,5.00,51.00,6.00;rect:53.00,3.00,52.00,4.00',
      expected: '2 map areas'
    }
  ])('summarizes the $description', ({ serialized, expected }) => {
    expect(describeRegions(serialized)).toBe(expected)
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
