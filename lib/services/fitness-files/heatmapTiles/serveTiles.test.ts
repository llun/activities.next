import { Database } from '@/lib/database/types'
import { FitnessRouteHeatmapPyramid } from '@/lib/types/database/fitnessRouteHeatmapTile'

import { MAX_TILES_PER_REQUEST } from './constants'
import {
  parseTileBatchQuery,
  parseTileIndexList,
  resolveShareRegionBounds,
  serveHeatmapTiles
} from './serveTiles'
import { decodeTile, encodeTile, tileKey } from './tileCodec'
import { tileBounds } from './tileRegion'

describe('parseTileIndexList', () => {
  it('parses a comma-separated x:y list', () => {
    expect(parseTileIndexList('1:2,3:4', 4)).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 }
    ])
  })

  it('accepts the last index at the zoom and rejects the one past it', () => {
    expect(parseTileIndexList('15:15', 4)).toEqual([{ x: 15, y: 15 }])
    expect(parseTileIndexList('16:15', 4)).toBeNull()
    expect(parseTileIndexList('15:16', 4)).toBeNull()
  })

  it('rejects a list longer than one request may ask for', () => {
    const exact = Array.from(
      { length: MAX_TILES_PER_REQUEST },
      (_, index) => `${index}:0`
    ).join(',')
    expect(parseTileIndexList(exact, 8)).toHaveLength(MAX_TILES_PER_REQUEST)
    expect(parseTileIndexList(`${exact},0:1`, 8)).toBeNull()
  })

  it.each([
    { description: 'a truncated pair', raw: '12:' },
    { description: 'a missing x', raw: ':3' },
    { description: 'a third part', raw: '1:2:3' },
    { description: 'a blank entry', raw: '1:2,,3:4' },
    { description: 'a negative index', raw: '-1:2' },
    { description: 'a fractional index', raw: '1.5:2' },
    { description: 'a hex index', raw: '0x2:1' },
    { description: 'a padded index', raw: ' 1 :2' },
    { description: 'an empty string', raw: '' }
  ])('rejects $description', ({ raw }) => {
    expect(parseTileIndexList(raw, 8)).toBeNull()
  })
})

describe('parseTileBatchQuery', () => {
  const query = (search: string) =>
    parseTileBatchQuery(new URL(`http://x/tiles?${search}`).searchParams)

  it('parses a zoom, a tile list and a version', () => {
    expect(query('z=8&tiles=1:2,3:4&v=7')).toEqual({
      z: 8,
      tiles: [
        { x: 1, y: 2 },
        { x: 3, y: 4 }
      ],
      version: 7
    })
  })

  it('omits the version when none was sent', () => {
    expect(query('z=8&tiles=1:2')).toEqual({ z: 8, tiles: [{ x: 1, y: 2 }] })
  })

  it('takes the FIRST of a repeated parameter, the same on every route', () => {
    // Both routes share this parser precisely so they cannot disagree here;
    // reading the query through `Object.fromEntries` would take the last.
    expect(query('z=4&z=16&tiles=1:1')?.z).toBe(4)
  })

  it.each([
    { description: 'a zoom off the ladder', search: 'z=9&tiles=1:1' },
    { description: 'a zoom past the ladder', search: 'z=18&tiles=1:1' },
    { description: 'no zoom', search: 'tiles=1:1' },
    { description: 'a blank zoom', search: 'z=&tiles=1:1' },
    { description: 'a non-numeric zoom', search: 'z=eight&tiles=1:1' },
    { description: 'a decimal-spelled zoom', search: 'z=4.0&tiles=1:1' },
    { description: 'a hex-spelled zoom', search: 'z=0x8&tiles=1:1' },
    { description: 'a padded zoom', search: 'z=%208&tiles=1:1' },
    { description: 'a signed zoom', search: 'z=%2B8&tiles=1:1' },
    { description: 'no tiles', search: 'z=8' },
    { description: 'a blank tile list', search: 'z=8&tiles=' },
    { description: 'a malformed tile', search: 'z=8&tiles=1:' },
    { description: 'a tile past the zoom', search: 'z=4&tiles=16:0' },
    { description: 'a negative version', search: 'z=8&tiles=1:1&v=-1' },
    { description: 'a non-numeric version', search: 'z=8&tiles=1:1&v=latest' },
    { description: 'a fractional version', search: 'z=8&tiles=1:1&v=1.5' }
  ])('refuses $description', ({ search }) => {
    expect(query(search)).toBeNull()
  })

  it('refuses a tiles parameter too long to be a legitimate batch', () => {
    expect(query(`z=8&tiles=${'1'.repeat(2000)}`)).toBeNull()
  })

  it('accepts the widest legitimate batch at the deepest zoom', () => {
    // 128 keys of "65535:65535" plus 127 commas is 1535 characters, one under
    // the cap — if that arithmetic ever slips, a full viewport stops loading.
    const tiles = Array.from(
      { length: MAX_TILES_PER_REQUEST },
      () => '65535:65535'
    ).join(',')
    expect(query(`z=16&tiles=${tiles}`)?.tiles).toHaveLength(
      MAX_TILES_PER_REQUEST
    )
  })
})

describe('resolveShareRegionBounds', () => {
  it('resolves the world sentinel to no clipping', () => {
    expect(resolveShareRegionBounds('')).toEqual([])
    expect(resolveShareRegionBounds('   ')).toEqual([])
  })

  it('resolves a rect scope to its bounds', () => {
    expect(resolveShareRegionBounds('rect:52.00,5.00,51.00,6.00')).toEqual([
      { minLat: 51, maxLat: 52, minLng: 5, maxLng: 6 }
    ])
  })

  it('refuses a non-empty region it cannot resolve rather than serving the world', () => {
    expect(resolveShareRegionBounds('rect:not-a-number,5,4,6')).toBeNull()
    expect(resolveShareRegionBounds('rect:52.00,5.00')).toBeNull()
    expect(resolveShareRegionBounds('nonsense')).toBeNull()
    // The world token cannot be stored — `serializeRegions` emits '' for it —
    // so this refuses a value no writer produces, on purpose.
    expect(resolveShareRegionBounds('world')).toBeNull()
  })
})

describe('serveHeatmapTiles', () => {
  const ACTOR_ID = 'https://llun.test/users/user1'
  const Z = 8
  const IN_X = 132
  const IN_Y = 85
  // Two out-of-region tiles that differ from the in-region one on ONE axis
  // each. A single fixture differing on both would hide a break in either half
  // of the intersection test, which is the whole of the pre-read guard.
  const EAST_X = 200
  const EAST_Y = 85
  const NORTH_X = 132
  const NORTH_Y = 20
  const OUT_X = EAST_X
  const OUT_Y = EAST_Y

  const inTile = tileBounds(Z, IN_X, IN_Y)
  const REGION_BOUNDS = [
    {
      minLat: (inTile.minLat + inTile.maxLat) / 2,
      maxLat: inTile.maxLat + 1,
      minLng: inTile.minLng - 1,
      maxLng: inTile.maxLng + 1
    }
  ]

  const mockDb = {
    getFitnessRouteHeatmapTilesByKeys: vi.fn()
  }
  const database = mockDb as unknown as Database

  const pyramid = (
    overrides: Partial<FitnessRouteHeatmapPyramid> = {}
  ): FitnessRouteHeatmapPyramid => ({
    id: 'pyramid-1',
    actorId: ACTOR_ID,
    status: 'completed',
    version: 4,
    claimSeq: 2,
    totalCount: 10,
    scannedCount: 10,
    activityCount: 10,
    tileCount: 2,
    pointCount: 100,
    createdAt: 1,
    updatedAt: 2,
    ...overrides
  })

  const tileRow = (x: number, y: number, segments: string, version = 4) => ({
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

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.getFitnessRouteHeatmapTilesByKeys.mockResolvedValue([])
  })

  const serve = (
    overrides: Partial<Parameters<typeof serveHeatmapTiles>[0]> = {}
  ) =>
    serveHeatmapTiles({
      database,
      actorId: ACTOR_ID,
      pyramid: pyramid(),
      z: Z,
      tiles: [{ x: IN_X, y: IN_Y }],
      regionBounds: [],
      stripPrivacy: false,
      ...overrides
    })

  it.each([
    { description: 'no pyramid at all', value: null },
    {
      description: 'a build still running',
      value: pyramid({ status: 'generating' })
    },
    { description: 'a failed build', value: pyramid({ status: 'failed' }) },
    {
      description: 'a cancelled build',
      value: pyramid({ status: 'cancelled' })
    },
    {
      description: 'a row that never built',
      value: pyramid({ status: 'idle', version: 0 })
    }
  ])('serves nothing for $description', async ({ value }) => {
    const result = await serve({ pyramid: value })
    expect(result).toEqual({ version: 0, tiles: { [`${IN_X}:${IN_Y}`]: null } })
    expect(mockDb.getFitnessRouteHeatmapTilesByKeys).not.toHaveBeenCalled()
  })

  it('forwards a stored tile as-is for the owner at world scope', async () => {
    const stored = encodeTile([{ count: 2, points: [0, 0, 8, 8] }])
    mockDb.getFitnessRouteHeatmapTilesByKeys.mockResolvedValue([
      tileRow(IN_X, IN_Y, stored)
    ])

    expect(await serve()).toEqual({
      version: 4,
      tiles: { [`${IN_X}:${IN_Y}`]: stored }
    })
  })

  it('answers a tile the pyramid does not have as empty', async () => {
    expect(await serve()).toEqual({
      version: 4,
      tiles: { [`${IN_X}:${IN_Y}`]: null }
    })
  })

  it('answers only the tiles that were asked for, whatever the read returns', async () => {
    mockDb.getFitnessRouteHeatmapTilesByKeys.mockResolvedValue([
      tileRow(IN_X, IN_Y, encodeTile([{ count: 2, points: [0, 0, 8, 8] }])),
      tileRow(OUT_X, OUT_Y, encodeTile([{ count: 9, points: [1, 1, 9, 9] }]))
    ])

    const result = await serve()
    expect(Object.keys(result.tiles)).toEqual([`${IN_X}:${IN_Y}`])
  })

  it('answers a tile left behind at an older version as empty', async () => {
    mockDb.getFitnessRouteHeatmapTilesByKeys.mockResolvedValue([
      tileRow(IN_X, IN_Y, encodeTile([{ count: 2, points: [0, 0, 8, 8] }]), 3)
    ])

    expect(await serve()).toEqual({
      version: 4,
      tiles: { [`${IN_X}:${IN_Y}`]: null }
    })
  })

  it.each([
    { description: 'east of it, at the same latitude', x: EAST_X, y: EAST_Y },
    {
      description: 'north of it, at the same longitude',
      x: NORTH_X,
      y: NORTH_Y
    }
  ])('never reads a tile $description', async ({ x, y }) => {
    const result = await serve({
      tiles: [
        { x: IN_X, y: IN_Y },
        { x, y }
      ],
      regionBounds: REGION_BOUNDS
    })

    expect(mockDb.getFitnessRouteHeatmapTilesByKeys).toHaveBeenCalledWith({
      actorId: ACTOR_ID,
      tileKeys: [tileKey(Z, IN_X, IN_Y)]
    })
    expect(result.tiles[`${x}:${y}`]).toBeNull()
  })

  it('reads nothing at all when every requested tile is out of region', async () => {
    const result = await serve({
      tiles: [
        { x: EAST_X, y: EAST_Y },
        { x: NORTH_X, y: NORTH_Y }
      ],
      regionBounds: REGION_BOUNDS
    })

    expect(mockDb.getFitnessRouteHeatmapTilesByKeys).not.toHaveBeenCalled()
    expect(result).toEqual({
      version: 4,
      tiles: {
        [`${EAST_X}:${EAST_Y}`]: null,
        [`${NORTH_X}:${NORTH_Y}`]: null
      }
    })
  })

  it('clips a boundary tile to the region', async () => {
    mockDb.getFitnessRouteHeatmapTilesByKeys.mockResolvedValue([
      tileRow(
        IN_X,
        IN_Y,
        encodeTile([{ count: 5, points: [0, 0, 8, 20, 16, 250, 24, 255] }])
      )
    ])

    const result = await serve({ regionBounds: REGION_BOUNDS })
    expect(decodeTile(result.tiles[`${IN_X}:${IN_Y}`])).toEqual([
      { count: 5, points: [0, 0, 8, 20] }
    ])
  })

  it('answers a tile clipped away to nothing as empty', async () => {
    mockDb.getFitnessRouteHeatmapTilesByKeys.mockResolvedValue([
      tileRow(IN_X, IN_Y, encodeTile([{ count: 5, points: [0, 250, 8, 255] }]))
    ])

    const result = await serve({ regionBounds: REGION_BOUNDS })
    expect(result.tiles[`${IN_X}:${IN_Y}`]).toBeNull()
  })

  it('strips the privacy class for a public request, keeping the geometry', async () => {
    const stored = encodeTile([
      { count: 5, hidden: true, points: [0, 0, 8, 8] },
      { count: 2, points: [16, 16, 24, 24] }
    ])
    mockDb.getFitnessRouteHeatmapTilesByKeys.mockResolvedValue([
      tileRow(IN_X, IN_Y, stored)
    ])

    const served = await serve({ stripPrivacy: true })
    const payload = served.tiles[`${IN_X}:${IN_Y}`]
    expect(payload).not.toBeNull()
    expect(payload).not.toContain('"h"')
    expect(decodeTile(payload)).toEqual([
      { count: 5, points: [0, 0, 8, 8] },
      { count: 2, points: [16, 16, 24, 24] }
    ])
  })

  it('re-encodes every byte it returns publicly rather than forwarding the stored string', async () => {
    // Stored payloads are trusted but not sanitised on write; a public response
    // is rebuilt from what `decodeTile` was willing to accept.
    mockDb.getFitnessRouteHeatmapTilesByKeys.mockResolvedValue([
      tileRow(
        IN_X,
        IN_Y,
        JSON.stringify({
          e: 256,
          s: [
            { c: 2, p: [0, 0, 8, 8], extra: 'ignored' },
            { c: 0, p: [1, 1, 2, 2] }
          ]
        })
      )
    ])

    const served = await serve({ stripPrivacy: true })
    expect(served.tiles[`${IN_X}:${IN_Y}`]).toBe(
      encodeTile([{ count: 2, points: [0, 0, 8, 8] }])
    )
  })
})
