import { Database } from '@/lib/database/types'
import { FitnessRouteHeatmapPyramid } from '@/lib/types/database/fitnessRouteHeatmapTile'

import {
  buildHeatmapSegmentsFromTiles,
  imageZoomForBounds
} from './segmentsFromTiles'
import { encodeTile, tileKey } from './tileCodec'
import { tileBounds } from './tileRegion'

describe('imageZoomForBounds', () => {
  // Amsterdam, then progressively wider scopes around it.
  const CITY_BLOCK = { minLat: 52.36, maxLat: 52.38, minLng: 4.88, maxLng: 4.9 }
  const CITY = { minLat: 52.3, maxLat: 52.42, minLng: 4.8, maxLng: 5.0 }
  const COUNTRY = { minLat: 50.7, maxLat: 53.6, minLng: 3.3, maxLng: 7.2 }
  const CONTINENT = { minLat: 35, maxLat: 70, minLng: -10, maxLng: 30 }

  it.each([
    { description: 'a city block', bounds: CITY_BLOCK, expected: 16 },
    { description: 'a city', bounds: CITY, expected: 14 },
    { description: 'a country', bounds: COUNTRY, expected: 8 },
    { description: 'a continent', bounds: CONTINENT, expected: 4 }
  ])('picks rung $expected for $description', ({ bounds, expected }) => {
    expect(imageZoomForBounds(bounds, 1200, 630)).toBe(expected)
  })

  it('drops a rung when the same scope is drawn half the size', () => {
    // What "one pixel" means is a property of the image, not of the ground, so
    // a thumbnail must not read tiles whose detail it cannot show.
    expect(imageZoomForBounds(CITY, 1200, 630)).toBe(14)
    expect(imageZoomForBounds(CITY, 600, 315)).toBe(12)
  })

  it('follows whichever axis the image is fitted by', () => {
    // `buildHeatmapSvg` fits with min(innerWidth / spanX, innerHeight / spanY),
    // so a tall scope in a wide image is limited by its height and a wide flat
    // one by its width. Reading longitude alone would ask for a rung finer than
    // the image can draw and fetch tiles nobody sees.
    const tall = { minLat: 52.3, maxLat: 52.42, minLng: 4.88, maxLng: 4.9 }
    const flat = { minLat: 52.35, maxLat: 52.37, minLng: 4.6, maxLng: 5.4 }

    expect(imageZoomForBounds(tall, 1200, 630)).toBe(14)
    expect(imageZoomForBounds(flat, 1200, 630)).toBe(12)
  })

  it.each([
    { description: 'a zero-width image', width: 0, height: 630 },
    { description: 'a zero-height image', width: 1200, height: 0 },
    {
      description: 'an empty span',
      width: 1200,
      height: 630,
      bounds: { minLat: 52, maxLat: 52, minLng: 5, maxLng: 5 }
    }
  ])(
    'falls back to the coarsest rung for $description',
    ({ width, height, bounds }) => {
      expect(imageZoomForBounds(bounds ?? CITY, width, height)).toBe(4)
    }
  )
})

describe('buildHeatmapSegmentsFromTiles', () => {
  const ACTOR_ID = 'https://llun.test/users/user1'
  const Z = 12
  const X = 2102
  const Y = 1344
  const tile = tileBounds(Z, X, Y)
  // Padded so a 600x400 image really does select rung 12 (0.02 - 0.1 degrees
  // of pad around the tile does; 0.01 buys rung 14 and 0.15 falls to 10). A
  // fixture whose geometry and rung disagree passes for the wrong reason.
  const PAD = 0.05
  const bounds = {
    minLat: tile.minLat - PAD,
    maxLat: tile.maxLat + PAD,
    minLng: tile.minLng - PAD,
    maxLng: tile.maxLng + PAD
  }

  const mockDb = {
    getFitnessRouteHeatmapPyramid: vi.fn(),
    getFitnessRouteHeatmapTilesInRange: vi.fn()
  }
  const database = mockDb as unknown as Database

  const pyramid = (
    overrides: Partial<FitnessRouteHeatmapPyramid> = {}
  ): FitnessRouteHeatmapPyramid => ({
    id: 'pyramid-1',
    actorId: ACTOR_ID,
    status: 'completed',
    version: 4,
    claimSeq: 1,
    totalCount: 1,
    scannedCount: 1,
    activityCount: 1,
    tileCount: 1,
    pointCount: 4,
    createdAt: 1,
    updatedAt: 2,
    ...overrides
  })

  const row = (segments: string, version = 4, x = X, y = Y) => ({
    actorId: ACTOR_ID,
    tileKey: tileKey(Z, x, y),
    z: Z,
    x,
    y,
    version,
    segments,
    pointCount: 2,
    createdAt: 1,
    updatedAt: 2
  })

  const build = (regionBounds = [] as never[]) =>
    buildHeatmapSegmentsFromTiles(database, {
      actorId: ACTOR_ID,
      bounds,
      width: 600,
      height: 400,
      regionBounds
    })

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.getFitnessRouteHeatmapPyramid.mockResolvedValue(pyramid())
    mockDb.getFitnessRouteHeatmapTilesInRange.mockResolvedValue([])
  })

  it('reads nothing for bounds that enclose no tile row', async () => {
    // Inverted bounds resolve to an empty row range: north is a smaller y in
    // Mercator, so a swapped pair puts minY past maxY. Handing that to the
    // database as a WHERE clause is a query that cannot match. The inversion
    // has to straddle tile rows to show it -- a swap of a tenth of a degree
    // collapses onto one row at the coarsest rung.
    const inverted = { minLat: 60, maxLat: -60, minLng: 4, maxLng: 5 }

    const segments = await buildHeatmapSegmentsFromTiles(database, {
      actorId: ACTOR_ID,
      bounds: inverted,
      width: 600,
      height: 400,
      regionBounds: []
    })

    expect(segments).toBeNull()
    expect(mockDb.getFitnessRouteHeatmapTilesInRange).not.toHaveBeenCalled()
  })

  it("places geometry with the tile row's own rung, not the view's", async () => {
    // A row carries its own z/x/y. Placing it with the rung the view happened
    // to ask for would draw it at the same tile index on a different rung,
    // which is a different part of the world entirely.
    const COARSE_Z = 10
    const coarseX = Math.floor(X / 4)
    const coarseY = Math.floor(Y / 4)
    mockDb.getFitnessRouteHeatmapTilesInRange.mockResolvedValue([
      {
        ...row(encodeTile([{ count: 1, points: [128, 128, 129, 129] }])),
        tileKey: tileKey(COARSE_Z, coarseX, coarseY),
        z: COARSE_Z,
        x: coarseX,
        y: coarseY
      }
    ])

    const segments = await build()
    const [point] = segments?.[0].points ?? []
    const coarse = tileBounds(COARSE_Z, coarseX, coarseY)

    expect(point.lng).toBeGreaterThanOrEqual(coarse.minLng)
    expect(point.lng).toBeLessThanOrEqual(coarse.maxLng)
    expect(point.lat).toBeGreaterThanOrEqual(coarse.minLat)
    expect(point.lat).toBeLessThanOrEqual(coarse.maxLat)
  })

  it.each([
    { description: 'no pyramid', value: null },
    {
      description: 'a build still running',
      value: pyramid({ status: 'generating' })
    },
    { description: 'a row that never built', value: pyramid({ version: 0 }) }
  ])(
    'answers null for $description, so the caller keeps the blob',
    async ({ value }) => {
      mockDb.getFitnessRouteHeatmapPyramid.mockResolvedValue(value)
      expect(await build()).toBeNull()
      expect(mockDb.getFitnessRouteHeatmapTilesInRange).not.toHaveBeenCalled()
    }
  )

  it('turns stored tiles into segments carrying their visit count', async () => {
    mockDb.getFitnessRouteHeatmapTilesInRange.mockResolvedValue([
      row(encodeTile([{ count: 7, points: [0, 0, 128, 128] }]))
    ])

    const segments = await build()
    expect(segments).toHaveLength(1)
    expect(segments![0].count).toBe(7)
    expect(segments![0].points).toHaveLength(2)
    // Placed on the globe from the tile's own coordinate, not tile-local.
    expect(segments![0].points[0].lat).toBeCloseTo(tile.maxLat, 6)
  })

  it('drops the privacy class while keeping the geometry', async () => {
    // The same flattening the other public surfaces apply: a hole or a
    // highlight around home would pinpoint it.
    mockDb.getFitnessRouteHeatmapTilesInRange.mockResolvedValue([
      row(encodeTile([{ count: 2, hidden: true, points: [0, 0, 64, 64] }]))
    ])

    const segments = await build()
    expect(segments).toHaveLength(1)
    expect(segments![0]).not.toHaveProperty('isHiddenByPrivacy')
  })

  it('ignores a tile left behind at an older version', async () => {
    // A rebuild in flight leaves two versions in the table at once, and drawing
    // them together shows heat no build ever produced.
    mockDb.getFitnessRouteHeatmapTilesInRange.mockResolvedValue([
      row(encodeTile([{ count: 3, points: [0, 0, 64, 64] }]), 3)
    ])

    expect(await build()).toEqual([])
  })

  it('clips a boundary tile to the share region rather than serving it whole', async () => {
    // The pyramid is stored UNCLIPPED and covers the actor's whole history, so
    // an image built from it without clipping publishes everywhere they ride.
    const northHalf = [
      {
        minLat: (tile.minLat + tile.maxLat) / 2,
        maxLat: tile.maxLat + 1,
        minLng: tile.minLng - 1,
        maxLng: tile.maxLng + 1
      }
    ]
    mockDb.getFitnessRouteHeatmapTilesInRange.mockResolvedValue([
      row(encodeTile([{ count: 5, points: [0, 0, 8, 20, 16, 250, 24, 255] }]))
    ])

    const segments = await build(northHalf as never)
    expect(segments).toHaveLength(1)
    expect(segments![0].points).toHaveLength(2)
    for (const point of segments![0].points) {
      expect(point.lat).toBeGreaterThanOrEqual(northHalf[0].minLat)
    }
  })

  it('drops a tile the share region cannot contain, without decoding it', async () => {
    const elsewhere = [{ minLat: -40, maxLat: -39, minLng: 170, maxLng: 171 }]
    mockDb.getFitnessRouteHeatmapTilesInRange.mockResolvedValue([
      row(encodeTile([{ count: 5, points: [0, 0, 64, 64] }]))
    ])

    expect(await build(elsewhere as never)).toEqual([])
  })

  it('reads both sides of the antimeridian as two ranges', async () => {
    // The range read is a `whereBetween`, which matches nothing when minX
    // exceeds maxX rather than wrapping around.
    await buildHeatmapSegmentsFromTiles(database, {
      actorId: ACTOR_ID,
      bounds: { minLat: -18.2, maxLat: -18.1, minLng: 179.9, maxLng: -179.9 },
      width: 600,
      height: 400,
      regionBounds: []
    })

    expect(mockDb.getFitnessRouteHeatmapTilesInRange).toHaveBeenCalledTimes(2)
    const [first, second] = mockDb.getFitnessRouteHeatmapTilesInRange.mock.calls
    expect(first[0].maxX).toBe(2 ** first[0].z - 1)
    expect(second[0].minX).toBe(0)
  })
})
