import {
  HEAT_COUNT_SATURATION,
  HEAT_HIDDEN_BASE_OPACITY,
  HEAT_VISIBLE_BASE_OPACITY,
  TILE_EXTENT,
  TILE_LADDER_ZOOMS,
  TILE_MAX_ZOOM,
  TILE_MIN_ZOOM,
  TILE_SIMPLIFY_TOLERANCE_PX,
  heatOpacityForCount,
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
