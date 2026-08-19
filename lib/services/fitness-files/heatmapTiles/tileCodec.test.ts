import { TILE_EXTENT } from '@/lib/services/fitness-files/heatmapTiles/constants'
import {
  countTilePoints,
  decodeTile,
  encodeTile,
  lngLatToTileLocal,
  parseTileKey,
  tileCountAtZoom,
  tileKey,
  tileLocalToLngLat,
  tilesForBounds
} from '@/lib/services/fitness-files/heatmapTiles/tileCodec'
import type { TileSegment } from '@/lib/services/fitness-files/heatmapTiles/tileCodec'

describe('tileKey and parseTileKey', () => {
  it('round trips a coordinate', () => {
    expect(parseTileKey(tileKey(16, 100, 200))).toEqual({
      z: 16,
      x: 100,
      y: 200
    })
  })

  it.each([
    { description: 'an empty string', key: '' },
    { description: 'too few parts', key: '16:100' },
    { description: 'too many parts', key: '16:100:200:1' },
    { description: 'a non-numeric part', key: '16:abc:200' },
    { description: 'a fractional index', key: '16:100.5:200' },
    { description: 'a negative index', key: '16:-1:200' },
    // Inside the ladder on purpose: a zoom below it is turned away by the zoom
    // bound and never reaches the index check at all.
    { description: 'an x past the last tile at that zoom', key: '4:16:0' },
    { description: 'a y past the last tile at that zoom', key: '4:0:16' }
  ])('rejects $description', ({ key }) => {
    expect(parseTileKey(key)).toBeNull()
  })

  it('accepts the last valid index at a zoom', () => {
    expect(parseTileKey('4:15:15')).toEqual({ z: 4, x: 15, y: 15 })
  })

  it.each([
    { description: 'an empty zoom part', key: ':1:1' },
    { description: 'an empty x part', key: '12::1' },
    {
      description: 'a truncated key with a trailing separator',
      key: '12:2103:'
    },
    { description: 'nothing but separators', key: '::' },
    { description: 'hex notation', key: '0x4:1:1' },
    { description: 'exponent notation', key: '1e1:5:5' },
    { description: 'padded whitespace', key: '4: 1 :1' },
    { description: 'a zoom below the ladder', key: '2:1:1' },
    { description: 'a zoom above the ladder', key: '18:1:1' },
    {
      description: 'a zoom so large the index bound goes infinite',
      key: '1024:1:1'
    }
  ])('rejects $description rather than coercing it', ({ key }) => {
    // `Number('')` is 0, so a truncated key would otherwise resolve to a real
    // but entirely different tile instead of being turned away.
    expect(parseTileKey(key)).toBeNull()
  })
})

describe('lngLatToTileLocal', () => {
  it('puts the antimeridian in the last tile, not one past it', () => {
    // The projection's own edge lands exactly at `scale`, whose floor is
    // 2**zoom — an index that does not exist. Clamping is what keeps a point
    // on the date line out of a phantom tile.
    const zoom = 4
    const placed = lngLatToTileLocal({ lat: 0, lng: 180 }, zoom)

    expect(placed.x).toBe(tileCountAtZoom(zoom) - 1)
    expect(placed.u).toBeCloseTo(TILE_EXTENT, 6)
  })

  it('puts the south Mercator edge in the last tile, not one past it', () => {
    const zoom = 4
    const placed = lngLatToTileLocal({ lat: -85.05112878, lng: 0 }, zoom)

    expect(placed.y).toBe(tileCountAtZoom(zoom) - 1)
  })

  it('keeps the local coordinate inside the space at the projection edges', () => {
    // The projection lands a hair outside its own grid at the limits — the
    // north edge gives about -1e-4 local units at z16 — and the space is what
    // callers are promised, so the local coordinate is clamped like the index.
    for (const zoom of [4, 16]) {
      const north = lngLatToTileLocal({ lat: 85.05112878, lng: 0 }, zoom)
      expect(north.v).toBeGreaterThanOrEqual(0)
      expect(north.v).toBeLessThanOrEqual(TILE_EXTENT)

      const south = lngLatToTileLocal({ lat: -85.05112878, lng: 180 }, zoom)
      expect(south.u).toBeGreaterThanOrEqual(0)
      expect(south.u).toBeLessThanOrEqual(TILE_EXTENT)
      expect(south.v).toBeGreaterThanOrEqual(0)
      expect(south.v).toBeLessThanOrEqual(TILE_EXTENT)
    }
  })

  it('clamps a latitude beyond the Mercator limit rather than overflowing', () => {
    const zoom = 6
    const placed = lngLatToTileLocal({ lat: -89.9, lng: 0 }, zoom)

    expect(placed.y).toBe(tileCountAtZoom(zoom) - 1)
    expect(Number.isFinite(placed.v)).toBe(true)
  })

  it.each([
    {
      description: 'the north-west corner of the world',
      lat: 85.05112878,
      lng: -180,
      x: 0,
      y: 0
    },
    { description: 'the origin', lat: 0, lng: 0, x: 2, y: 2 }
  ])('places $description at zoom 2', ({ lat, lng, x, y }) => {
    const placed = lngLatToTileLocal({ lat, lng }, 2)
    expect({ x: placed.x, y: placed.y }).toEqual({ x, y })
  })
})

describe('tileLocalToLngLat', () => {
  it.each([
    { description: 'the equator on the prime meridian', lat: 0, lng: 0 },
    { description: 'a northern city', lat: 52.370216, lng: 4.895168 },
    { description: 'a southern point', lat: -33.8688, lng: 151.2093 },
    { description: 'a point near the Mercator limit', lat: 84.9, lng: -179.9 }
  ])('inverts the projection for $description', ({ lat, lng }) => {
    const zoom = 16
    const placed = lngLatToTileLocal({ lat, lng }, zoom)
    const back = tileLocalToLngLat(zoom, placed.x, placed.y, placed.u, placed.v)

    expect(back.lat).toBeCloseTo(lat, 6)
    expect(back.lng).toBeCloseTo(lng, 6)
  })

  it('lands within half a pixel once the local coordinate is quantized', () => {
    // What the stored format actually holds: rounded integers. The error a
    // reader inherits must stay under the pixel the value was rounded to.
    const zoom = 16
    const point = { lat: 52.370216, lng: 4.895168 }
    const placed = lngLatToTileLocal(point, zoom)
    const back = tileLocalToLngLat(
      zoom,
      placed.x,
      placed.y,
      Math.round(placed.u),
      Math.round(placed.v)
    )

    const metersPerPixel = 2.3886571337890623
    const latMeters = Math.abs(back.lat - point.lat) * 111_320
    expect(latMeters).toBeLessThanOrEqual(metersPerPixel)
  })

  it('agrees with the tile the forward projection chose', () => {
    const zoom = 12
    const placed = lngLatToTileLocal({ lat: 48.8584, lng: 2.2945 }, zoom)
    const centre = tileLocalToLngLat(
      zoom,
      placed.x,
      placed.y,
      TILE_EXTENT / 2,
      TILE_EXTENT / 2
    )

    const replaced = lngLatToTileLocal(centre, zoom)
    expect({ x: replaced.x, y: replaced.y }).toEqual({
      x: placed.x,
      y: placed.y
    })
  })
})

describe('tilesForBounds', () => {
  it('covers the tile a small box sits in', () => {
    const range = tilesForBounds(
      { minLat: 52.36, maxLat: 52.38, minLng: 4.88, maxLng: 4.9 },
      10
    )

    expect(range.minX).toBeLessThanOrEqual(range.maxX)
    expect(range.minY).toBeLessThanOrEqual(range.maxY)
    const placed = lngLatToTileLocal({ lat: 52.37, lng: 4.89 }, 10)
    expect(placed.x).toBeGreaterThanOrEqual(range.minX)
    expect(placed.x).toBeLessThanOrEqual(range.maxX)
    expect(placed.y).toBeGreaterThanOrEqual(range.minY)
    expect(placed.y).toBeLessThanOrEqual(range.maxY)
  })

  it('orders y from the northern edge, which Mercator numbers lowest', () => {
    const range = tilesForBounds(
      { minLat: -10, maxLat: 10, minLng: -10, maxLng: 10 },
      8
    )
    expect(range.minY).toBeLessThanOrEqual(range.maxY)
  })

  it('clamps a whole-world box to the grid at every ladder zoom', () => {
    for (const zoom of [4, 8, 16]) {
      const range = tilesForBounds(
        { minLat: -90, maxLat: 90, minLng: -180, maxLng: 180 },
        zoom
      )
      expect(range.minX).toBe(0)
      expect(range.minY).toBe(0)
      expect(range.maxX).toBe(tileCountAtZoom(zoom) - 1)
      expect(range.maxY).toBe(tileCountAtZoom(zoom) - 1)
    }
  })

  it('reports minX past maxX for an antimeridian-straddling box, for the caller to split', () => {
    // Deliberate: the range read uses `whereBetween`, which matches nothing in
    // that state rather than silently wrapping across the whole map.
    const range = tilesForBounds(
      { minLat: -10, maxLat: 10, minLng: 170, maxLng: -170 },
      6
    )
    expect(range.minX).toBeGreaterThan(range.maxX)
  })
})

describe('encodeTile and decodeTile', () => {
  const visible: TileSegment = { count: 3, points: [0, 0, 8, 8] }
  const hidden: TileSegment = { count: 1, hidden: true, points: [1, 1, 2, 2] }

  it('round trips a mixed tile', () => {
    expect(decodeTile(encodeTile([visible, hidden]))).toEqual([visible, hidden])
  })

  it('omits the privacy flag for visible geometry and sets it for hidden', () => {
    expect(encodeTile([visible])).not.toContain('"h"')
    expect(encodeTile([hidden])).toContain('"h":1')
  })

  it('records the extent its coordinates are in', () => {
    expect(JSON.parse(encodeTile([visible])).e).toBe(TILE_EXTENT)
  })

  it('survives the endpoints of the coordinate space', () => {
    const edge: TileSegment = {
      count: 1,
      points: [0, 0, TILE_EXTENT, TILE_EXTENT]
    }
    expect(decodeTile(encodeTile([edge]))).toEqual([edge])
  })

  it.each([
    { description: 'an empty string', encoded: '' },
    { description: 'null', encoded: null },
    { description: 'undefined', encoded: undefined },
    { description: 'truncated json', encoded: '{"e":256,"s":[{"c":1,"p":[0,0' },
    { description: 'json that is not an object', encoded: '42' },
    { description: 'an object with no segments', encoded: '{"e":256}' },
    {
      description: 'segments that are not an array',
      encoded: '{"e":256,"s":{}}'
    }
  ])('answers an empty tile for $description', ({ encoded }) => {
    expect(decodeTile(encoded)).toEqual([])
  })

  it.each([
    // Long enough to clear the minimum-length guard, so this really does test
    // the parity check: without it the tile decodes with a dangling coordinate
    // and `countTilePoints` answers a fraction.
    {
      description: 'an odd-length point list',
      segment: '{"c":1,"p":[0,0,8,8,4]}'
    },
    {
      description: 'a point list too short to be a line, of odd length',
      segment: '{"c":1,"p":[0,0,8]}'
    },
    {
      description: 'a point list holding a single point',
      segment: '{"c":1,"p":[0,0]}'
    },
    {
      description: 'a coordinate past the extent',
      segment: '{"c":1,"p":[0,0,257,8]}'
    },
    { description: 'a negative coordinate', segment: '{"c":1,"p":[0,0,-1,8]}' },
    {
      description: 'a fractional coordinate',
      segment: '{"c":1,"p":[0,0,8.5,8]}'
    },
    {
      description: 'a non-numeric coordinate',
      segment: '{"c":1,"p":[0,0,"x",8]}'
    },
    { description: 'a missing count', segment: '{"p":[0,0,8,8]}' },
    { description: 'a zero count', segment: '{"c":0,"p":[0,0,8,8]}' },
    { description: 'a null count', segment: '{"c":null,"p":[0,0,8,8]}' },
    // Reaches the finiteness check specifically: `null` is turned away one
    // condition earlier by the type test, so it alone leaves that check unpinned.
    { description: 'an infinite count', segment: '{"c":1e999,"p":[0,0,8,8]}' }
  ])('drops $description without taking the tile with it', ({ segment }) => {
    const encoded = `{"e":256,"s":[${segment},{"c":2,"p":[1,1,2,2]}]}`
    expect(decodeTile(encoded)).toEqual([{ count: 2, points: [1, 1, 2, 2] }])
  })

  it('rounds a fractional count to a whole number of visits', () => {
    expect(decodeTile('{"e":256,"s":[{"c":2.6,"p":[0,0,8,8]}]}')).toEqual([
      { count: 3, points: [0, 0, 8, 8] }
    ])
  })

  it('never throws, whatever it is handed', () => {
    for (const encoded of ['', '{', 'null', '[]', '{"s":[null]}', 'NaN']) {
      expect(() => decodeTile(encoded)).not.toThrow()
    }
  })
})

describe('countTilePoints', () => {
  it('counts stored vertices, which is what the pyramid totals sum', () => {
    expect(
      countTilePoints([
        { count: 1, points: [0, 0, 8, 8] },
        { count: 2, points: [1, 1, 2, 2, 3, 3] }
      ])
    ).toBe(5)
  })

  it('is zero for an empty tile', () => {
    expect(countTilePoints([])).toBe(0)
  })
})
