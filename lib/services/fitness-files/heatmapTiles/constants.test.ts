import {
  HEAT_COUNT_COLOR_STOPS,
  HEAT_COUNT_SATURATION,
  HEAT_HIDDEN_BASE_OPACITY,
  HEAT_VISIBLE_BASE_OPACITY,
  TILE_EXTENT,
  TILE_LADDER_ZOOMS,
  TILE_MAX_ZOOM,
  TILE_MIN_ZOOM,
  TILE_SIMPLIFY_TOLERANCE_PX,
  heatColorForCount,
  heatOpacityForCount,
  heatWidthForCount,
  metersPerPixelAtZoom,
  tileToleranceMeters
} from '@/lib/services/fitness-files/heatmapTiles/constants'
import { TILE_SIZE } from '@/lib/utils/webMercator'

describe('metersPerPixelAtZoom', () => {
  // Measured ground resolution, the figure the whole ladder is chosen from.
  it.each([
    {
      description: 'z4 at the equator',
      zoom: 4,
      latitude: 0,
      expected: 9783.94
    },
    { description: 'z8 at the equator', zoom: 8, latitude: 0, expected: 611.5 },
    {
      description: 'z12 at the equator',
      zoom: 12,
      latitude: 0,
      expected: 38.22
    },
    {
      description: 'z16 at the equator',
      zoom: 16,
      latitude: 0,
      expected: 2.39
    },
    // cos(60) is exactly 0.5, so this pins the latitude scaling itself.
    {
      description: 'z16 at 60N, half the equator figure',
      zoom: 16,
      latitude: 60,
      expected: 1.19
    }
  ])('reports $description', ({ zoom, latitude, expected }) => {
    expect(metersPerPixelAtZoom(zoom, latitude)).toBeCloseTo(expected, 2)
  })

  it('halves for every zoom level gained', () => {
    for (let zoom = 1; zoom <= 18; zoom += 1) {
      expect(metersPerPixelAtZoom(zoom, 0)).toBeCloseTo(
        metersPerPixelAtZoom(zoom - 1, 0) / 2,
        6
      )
    }
  })
})

describe('tileToleranceMeters', () => {
  it.each([
    { description: 'z8 at the equator', zoom: 8, latitude: 0, expected: 611.5 },
    {
      description: 'z12 at the equator',
      zoom: 12,
      latitude: 0,
      expected: 38.22
    },
    { description: 'z16 at the equator', zoom: 16, latitude: 0, expected: 2.39 }
  ])(
    'passes $description through, being above the floor',
    ({ zoom, latitude, expected }) => {
      expect(tileToleranceMeters(zoom, latitude, 1)).toBeCloseTo(expected, 2)
    }
  )

  it('clamps to the floor where a pixel is finer than GPS noise', () => {
    // z16 at 80N is 0.41m/px — below the 1m floor, so simplifying to it would
    // preserve jitter as though it were shape.
    expect(metersPerPixelAtZoom(16, 80)).toBeLessThan(1)
    expect(tileToleranceMeters(16, 80, 1)).toBe(1)
  })

  it('is the per-pixel figure times the pixel tolerance, not a fixed table', () => {
    // Pinned as the relation rather than copied numbers: change the pixel
    // tolerance and every level must move with it.
    for (const zoom of TILE_LADDER_ZOOMS) {
      expect(tileToleranceMeters(zoom, 0, 0)).toBeCloseTo(
        metersPerPixelAtZoom(zoom, 0) * TILE_SIMPLIFY_TOLERANCE_PX,
        6
      )
    }
  })

  it('never returns less than the floor at any ladder zoom or latitude', () => {
    for (const zoom of TILE_LADDER_ZOOMS) {
      for (const latitude of [0, 45, 60, 80, 85]) {
        expect(tileToleranceMeters(zoom, latitude, 1)).toBeGreaterThanOrEqual(1)
      }
    }
  })
})

describe('heatOpacityForCount', () => {
  it.each([
    { count: 1, expected: 0.55 },
    { count: 2, expected: 0.7975 },
    { count: 3, expected: 0.908875 },
    { count: 4, expected: 0.95899375 }
  ])(
    'stacks $count visits the way overdrawing $count translucent lines did',
    ({ count, expected }) => {
      expect(heatOpacityForCount(count, HEAT_VISIBLE_BASE_OPACITY)).toBeCloseTo(
        expected,
        8
      )
    }
  )

  it('reproduces the additive-alpha formula exactly, at both bases', () => {
    // The compatibility-bearing part: computed from the formula rather than
    // compared against copied literals, so the two can never drift.
    for (const base of [HEAT_VISIBLE_BASE_OPACITY, HEAT_HIDDEN_BASE_OPACITY]) {
      for (let count = 1; count <= HEAT_COUNT_SATURATION; count += 1) {
        expect(heatOpacityForCount(count, base)).toBeCloseTo(
          1 - (1 - base) ** count,
          10
        )
      }
    }
  })

  it('pins the saturation point itself, not just its own consequences', () => {
    // Every other assertion here derives from the constant, so they hold for
    // any value it takes. Six is the point where the ramp reaches 0.99 and
    // further visits stop being visible.
    expect(HEAT_COUNT_SATURATION).toBe(6)
    expect(heatOpacityForCount(7, HEAT_VISIBLE_BASE_OPACITY)).toBeCloseTo(
      1 - 0.45 ** 6,
      10
    )
    expect(heatOpacityForCount(5, HEAT_VISIBLE_BASE_OPACITY)).toBeCloseTo(
      1 - 0.45 ** 5,
      10
    )
  })

  it('starts the privacy-trimmed class at the opacity the untiled map draws', () => {
    // Its whole reason for existing is matching what the map already renders.
    expect(HEAT_HIDDEN_BASE_OPACITY).toBe(0.4)
    expect(heatOpacityForCount(1, HEAT_HIDDEN_BASE_OPACITY)).toBeCloseTo(
      0.4,
      10
    )
    expect(heatOpacityForCount(2, HEAT_HIDDEN_BASE_OPACITY)).toBeCloseTo(
      0.64,
      10
    )
  })

  it('rounds a fractional count rather than raising to a fractional power', () => {
    // Counts are whole visits; a fraction can only arrive from corrupt data,
    // and the ramp should answer the nearest real count rather than something
    // between two of them.
    expect(heatOpacityForCount(2.6, HEAT_VISIBLE_BASE_OPACITY)).toBeCloseTo(
      heatOpacityForCount(3, HEAT_VISIBLE_BASE_OPACITY),
      10
    )
    expect(heatOpacityForCount(2.4, HEAT_VISIBLE_BASE_OPACITY)).toBeCloseTo(
      heatOpacityForCount(2, HEAT_VISIBLE_BASE_OPACITY),
      10
    )
  })

  it('saturates past the clamp instead of climbing forever', () => {
    const saturated = heatOpacityForCount(
      HEAT_COUNT_SATURATION,
      HEAT_VISIBLE_BASE_OPACITY
    )
    for (const count of [HEAT_COUNT_SATURATION + 1, 50, 10_000]) {
      expect(heatOpacityForCount(count, HEAT_VISIBLE_BASE_OPACITY)).toBe(
        saturated
      )
    }
  })

  it.each([
    { description: 'zero', count: 0 },
    { description: 'a negative count', count: -3 }
  ])('floors $description at a single visit', ({ count }) => {
    expect(heatOpacityForCount(count, HEAT_VISIBLE_BASE_OPACITY)).toBeCloseTo(
      HEAT_VISIBLE_BASE_OPACITY,
      10
    )
  })

  it('never leaves the drawable range', () => {
    for (const base of [HEAT_VISIBLE_BASE_OPACITY, HEAT_HIDDEN_BASE_OPACITY]) {
      for (const count of [0, 1, 3, 6, 99]) {
        const opacity = heatOpacityForCount(count, base)
        expect(opacity).toBeGreaterThan(0)
        expect(opacity).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('HEAT_COUNT_COLOR_STOPS', () => {
  it('ascends in count, which a GL interpolate requires', () => {
    const counts = HEAT_COUNT_COLOR_STOPS.filter(
      (_unused, index) => index % 2 === 0
    ) as number[]
    for (let i = 1; i < counts.length; i += 1) {
      expect(counts[i]).toBeGreaterThan(counts[i - 1])
    }
  })
})

describe('heatColorForCount', () => {
  it.each([
    { description: 'a count of one', count: 1, expected: '#ef4444' },
    { description: 'the orange stop', count: 4, expected: '#f97316' },
    { description: 'the yellow stop', count: 12, expected: '#facc15' },
    // Below the first stop and past the last hold the end colours, as GL does.
    { description: 'a count below the ramp', count: 0, expected: '#ef4444' },
    { description: 'a count past the ramp', count: 99, expected: '#facc15' },
    // 1 -> 4 is 3 counts wide, so count 2.5 is half way: per channel
    // (239+249)/2 -> 244, (68+115)/2 -> 91.5 -> 92, (68+22)/2 -> 45.
    {
      description: 'half way from red to orange',
      count: 2.5,
      expected: '#f45c2d'
    }
  ])('answers $expected for $description', ({ count, expected }) => {
    expect(heatColorForCount(count, HEAT_COUNT_COLOR_STOPS)).toBe(expected)
  })

  it('blends over any stop list it is given', () => {
    expect(heatColorForCount(1, [4, '#f97316', 12, '#facc15'])).toBe('#f97316')
    expect(heatColorForCount(8, [4, '#000000', 12, '#ffffff'])).toBe('#808080')
    // A channel below 0x10 keeps its leading zero: 5 -> '05', not '5'.
    expect(heatColorForCount(8, [4, '#000000', 12, '#0a141e'])).toBe('#050a0f')
  })
})

describe('heatWidthForCount', () => {
  it.each([
    { description: 'a count of one', count: 1, expected: 2.8 },
    { description: 'the orange stop', count: 4, expected: 3.4 },
    { description: 'the last stop', count: 16, expected: 4.2 },
    // Below the first stop and past the last hold the end widths, as GL does.
    { description: 'a count below the ramp', count: 0, expected: 2.8 },
    { description: 'a count past the ramp', count: 99, expected: 4.2 },
    // 1 -> 4 is 3 counts wide, so count 2.5 is half way: (2.8 + 3.4) / 2.
    { description: 'half way to the second stop', count: 2.5, expected: 3.1 },
    // Width is still growing at 12, where the colour has already stopped:
    // 4 -> 16 is 12 counts wide, so 12 is two thirds of the way from 3.4 to 4.2.
    { description: 'the yellow colour stop', count: 12, expected: 3.9333 }
  ])('answers $expected for $description', ({ count, expected }) => {
    expect(heatWidthForCount(count)).toBeCloseTo(expected, 4)
  })

  it('blends over any stop list it is given', () => {
    expect(heatWidthForCount(8, [4, 2, 12, 6])).toBe(4)
  })
})

describe('format invariants', () => {
  it('keeps one stored unit equal to one screen pixel', () => {
    // The identity the whole design rests on: quantizing to this collapses GPS
    // jitter onto shared edges instead of near-miss polylines.
    expect(TILE_EXTENT).toBe(TILE_SIZE)
  })

  it('stops the ladder at the GPS-noise floor', () => {
    // Finer than ~2.4m/px would encode jitter rather than road.
    expect(metersPerPixelAtZoom(TILE_MAX_ZOOM, 0)).toBeCloseTo(2.39, 2)
    expect(metersPerPixelAtZoom(TILE_MAX_ZOOM + 2, 0)).toBeLessThan(1)
  })

  it('is ascending, unique, and spans its own min and max', () => {
    expect([...TILE_LADDER_ZOOMS]).toEqual(
      [...TILE_LADDER_ZOOMS].sort((a, b) => a - b)
    )
    expect(new Set(TILE_LADDER_ZOOMS).size).toBe(TILE_LADDER_ZOOMS.length)
    expect(TILE_MIN_ZOOM).toBe(Math.min(...TILE_LADDER_ZOOMS))
    expect(TILE_MAX_ZOOM).toBe(Math.max(...TILE_LADDER_ZOOMS))
  })

  it('steps evenly, so each level costs a quarter of the one below', () => {
    const steps = TILE_LADDER_ZOOMS.slice(1).map(
      (zoom, index) => zoom - TILE_LADDER_ZOOMS[index]
    )
    expect(new Set(steps)).toEqual(new Set([2]))
  })
})
