import { TILE_EXTENT } from './constants'
import { TileSegment, tileLocalToLngLat } from './tileCodec'
import {
  classifyTileAgainstRegion,
  clipTileSegmentsToRegion,
  tileBounds
} from './tileRegion'

describe('tileBounds', () => {
  it('returns the whole world for the single tile at zoom 0', () => {
    const bounds = tileBounds(0, 0, 0)
    expect(bounds.minLng).toBeCloseTo(-180, 9)
    expect(bounds.maxLng).toBeCloseTo(180, 9)
    // The Mercator latitude limit, which is what a whole-world tile reaches.
    expect(bounds.maxLat).toBeCloseTo(85.0511287798, 8)
    expect(bounds.minLat).toBeCloseTo(-85.0511287798, 8)
  })

  it('returns the south-west quadrant of the north-west quadrant at zoom 2', () => {
    // worldX 0.25..0.5 is -90..0; worldY 0.25..0.5 is 66.51°N..0.
    const bounds = tileBounds(2, 1, 1)
    expect(bounds.minLng).toBeCloseTo(-90, 9)
    expect(bounds.maxLng).toBeCloseTo(0, 9)
    expect(bounds.maxLat).toBeCloseTo(66.5132604431, 8)
    expect(bounds.minLat).toBeCloseTo(0, 9)
  })

  it('puts north at the smaller v, which is what the stored tiles assume', () => {
    const bounds = tileBounds(8, 130, 84)
    expect(tileLocalToLngLat(8, 130, 84, 0, 0).lat).toBe(bounds.maxLat)
    expect(tileLocalToLngLat(8, 130, 84, 0, TILE_EXTENT).lat).toBe(
      bounds.minLat
    )
  })
})

describe('classifyTileAgainstRegion', () => {
  const Z = 8
  const X = 132
  const Y = 85
  const tile = tileBounds(Z, X, Y)
  const pad = 0.5

  it('reports every tile inside when the scope is world-wide', () => {
    expect(classifyTileAgainstRegion(Z, X, Y, [])).toBe('inside')
    expect(classifyTileAgainstRegion(16, 0, 0, [])).toBe('inside')
  })

  it('reports a tile a rect fully covers as inside', () => {
    expect(
      classifyTileAgainstRegion(Z, X, Y, [
        {
          minLat: tile.minLat - pad,
          maxLat: tile.maxLat + pad,
          minLng: tile.minLng - pad,
          maxLng: tile.maxLng + pad
        }
      ])
    ).toBe('inside')
  })

  it('reports a tile no rect reaches as outside', () => {
    expect(
      classifyTileAgainstRegion(Z, X, Y, [
        {
          minLat: tile.maxLat + pad,
          maxLat: tile.maxLat + pad * 2,
          minLng: tile.minLng,
          maxLng: tile.maxLng
        }
      ])
    ).toBe('outside')
  })

  it('reports a tile a rect only partly covers as partial', () => {
    const midLat = (tile.minLat + tile.maxLat) / 2
    expect(
      classifyTileAgainstRegion(Z, X, Y, [
        {
          minLat: midLat,
          maxLat: tile.maxLat + pad,
          minLng: tile.minLng - pad,
          maxLng: tile.maxLng + pad
        }
      ])
    ).toBe('partial')
  })

  it('treats a rect sharing only an edge with the tile as partial, not outside', () => {
    expect(
      classifyTileAgainstRegion(Z, X, Y, [
        {
          minLat: tile.maxLat,
          maxLat: tile.maxLat + pad,
          minLng: tile.minLng,
          maxLng: tile.maxLng
        }
      ])
    ).toBe('partial')
  })

  it('reports a union that covers the tile as partial, which clips to the same geometry', () => {
    const midLat = (tile.minLat + tile.maxLat) / 2
    expect(
      classifyTileAgainstRegion(Z, X, Y, [
        {
          minLat: tile.minLat - pad,
          maxLat: midLat,
          minLng: tile.minLng - pad,
          maxLng: tile.maxLng + pad
        },
        {
          minLat: midLat,
          maxLat: tile.maxLat + pad,
          minLng: tile.minLng - pad,
          maxLng: tile.maxLng + pad
        }
      ])
    ).toBe('partial')
  })

  it('reports a rect exactly equal to the tile as inside', () => {
    expect(classifyTileAgainstRegion(Z, X, Y, [{ ...tile }])).toBe('inside')
  })

  it.each([
    { description: 'the south edge', edge: 'minLat' as const },
    { description: 'the north edge', edge: 'maxLat' as const },
    { description: 'the west edge', edge: 'minLng' as const },
    { description: 'the east edge', edge: 'maxLng' as const }
  ])('reports partial for a rect a hair short of $description', ({ edge }) => {
    // A tolerance anywhere in `contains` would read these as inside and serve
    // the whole tile, which at this zoom is kilometres outside the region.
    const shrink = edge === 'minLat' || edge === 'minLng' ? 1e-9 : -1e-9
    expect(
      classifyTileAgainstRegion(Z, X, Y, [
        { ...tile, [edge]: tile[edge] + shrink }
      ])
    ).toBe('partial')
  })

  it('discriminates on LONGITUDE, not only latitude', () => {
    const midLng = (tile.minLng + tile.maxLng) / 2
    const westHalf = {
      minLat: tile.minLat - pad,
      maxLat: tile.maxLat + pad,
      minLng: tile.minLng - pad,
      maxLng: midLng
    }
    expect(classifyTileAgainstRegion(Z, X, Y, [westHalf])).toBe('partial')
    expect(
      classifyTileAgainstRegion(Z, X, Y, [
        {
          ...westHalf,
          minLng: tile.maxLng + pad,
          maxLng: tile.maxLng + pad * 2
        }
      ])
    ).toBe('outside')
  })

  it('reaches nothing through an inverted rect, rather than wrapping', () => {
    expect(
      classifyTileAgainstRegion(Z, X, Y, [
        {
          minLat: tile.minLat,
          maxLat: tile.maxLat,
          minLng: tile.maxLng + pad,
          maxLng: tile.minLng - pad
        }
      ])
    ).toBe('outside')
  })
})

describe('clipTileSegmentsToRegion', () => {
  const Z = 8
  const X = 132
  const Y = 85
  const tile = tileBounds(Z, X, Y)
  // The northern half of the tile, in degrees: v below the midpoint survives.
  const northHalf = [
    {
      minLat: (tile.minLat + tile.maxLat) / 2,
      maxLat: tile.maxLat + 1,
      minLng: tile.minLng - 1,
      maxLng: tile.maxLng + 1
    }
  ]

  const segment = (points: number[], extra: Partial<TileSegment> = {}) => ({
    count: 3,
    points,
    ...extra
  })

  it('returns the segments untouched when the scope is world-wide', () => {
    const segments = [segment([0, 0, 10, 10])]
    expect(clipTileSegmentsToRegion(Z, X, Y, segments, [])).toBe(segments)
  })

  it('forwards a segment whose every point is inside without rebuilding it', () => {
    const inside = segment([0, 0, 128, 40])
    const result = clipTileSegmentsToRegion(Z, X, Y, [inside], northHalf)
    expect(result).toEqual([inside])
    expect(result[0]).toBe(inside)
  })

  it('drops the points outside and keeps the count', () => {
    const result = clipTileSegmentsToRegion(
      Z,
      X,
      Y,
      [segment([0, 0, 10, 20, 20, 250, 30, 255])],
      northHalf
    )
    expect(result).toEqual([{ count: 3, points: [0, 0, 10, 20] }])
  })

  it('splits a run that leaves the region and comes back', () => {
    const result = clipTileSegmentsToRegion(
      Z,
      X,
      Y,
      [segment([0, 0, 10, 10, 20, 250, 30, 251, 40, 20, 50, 10])],
      northHalf
    )
    expect(result).toEqual([
      { count: 3, points: [0, 0, 10, 10] },
      { count: 3, points: [40, 20, 50, 10] }
    ])
  })

  it('drops a run left with a single point, which draws no line', () => {
    expect(
      clipTileSegmentsToRegion(
        Z,
        X,
        Y,
        [segment([0, 0, 10, 250, 20, 251, 30, 252])],
        northHalf
      )
    ).toEqual([])
  })

  it('keeps the privacy class on a clipped run', () => {
    expect(
      clipTileSegmentsToRegion(
        Z,
        X,
        Y,
        [segment([0, 0, 10, 20, 20, 250], { hidden: true })],
        northHalf
      )
    ).toEqual([{ count: 3, hidden: true, points: [0, 0, 10, 20] }])
  })

  // The latitude cases above pad longitude on both sides, so they cannot tell a
  // longitude-blind clipper from a correct one. This half is the mirror.
  const westHalf = [
    {
      minLat: tile.minLat - 1,
      maxLat: tile.maxLat + 1,
      minLng: tile.minLng - 1,
      maxLng: (tile.minLng + tile.maxLng) / 2
    }
  ]

  it('drops the points east of the region', () => {
    const result = clipTileSegmentsToRegion(
      Z,
      X,
      Y,
      [segment([0, 0, 20, 10, 250, 20, 255, 30])],
      westHalf
    )
    expect(result).toEqual([{ count: 3, points: [0, 0, 20, 10] }])
  })

  it('splits a run that leaves the region to the east and comes back', () => {
    const result = clipTileSegmentsToRegion(
      Z,
      X,
      Y,
      [segment([0, 0, 10, 10, 250, 20, 251, 30, 20, 40, 30, 50])],
      westHalf
    )
    expect(result).toEqual([
      { count: 3, points: [0, 0, 10, 10] },
      { count: 3, points: [20, 40, 30, 50] }
    ])
  })

  it('never returns a point east of a longitude-bounded region', () => {
    const result = clipTileSegmentsToRegion(
      Z,
      X,
      Y,
      [segment(Array.from({ length: 64 }, (_, index) => index * 4))],
      westHalf
    )

    for (const run of result) {
      for (let index = 0; index < run.points.length; index += 2) {
        const point = tileLocalToLngLat(
          Z,
          X,
          Y,
          run.points[index],
          run.points[index + 1]
        )
        expect(point.lng).toBeGreaterThanOrEqual(westHalf[0].minLng)
        expect(point.lng).toBeLessThanOrEqual(westHalf[0].maxLng)
      }
    }
    expect(result.length).toBeGreaterThan(0)
  })

  it('never returns a point the region does not contain', () => {
    const result = clipTileSegmentsToRegion(
      Z,
      X,
      Y,
      [segment(Array.from({ length: 64 }, (_, index) => index * 4))],
      northHalf
    )

    for (const run of result) {
      for (let index = 0; index < run.points.length; index += 2) {
        const point = tileLocalToLngLat(
          Z,
          X,
          Y,
          run.points[index],
          run.points[index + 1]
        )
        expect(point.lat).toBeGreaterThanOrEqual(northHalf[0].minLat)
        expect(point.lat).toBeLessThanOrEqual(northHalf[0].maxLat)
      }
    }
    expect(result.length).toBeGreaterThan(0)
  })
})
