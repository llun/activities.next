import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import {
  decodeTile,
  encodeTile,
  tileKey
} from '@/lib/services/fitness-files/heatmapTiles/tileCodec'
import { tileBounds } from '@/lib/services/fitness-files/heatmapTiles/tileRegion'
import { FitnessRouteHeatmapPyramid } from '@/lib/types/database/fitnessRouteHeatmapTile'

import { GET } from './route'

type MockDatabase = Pick<
  Database,
  | 'getFitnessRouteHeatmapByShareToken'
  | 'getFitnessRouteHeatmapSummaryByShareToken'
  | 'getFitnessRouteHeatmapPyramid'
  | 'getFitnessRouteHeatmapTilesByKeys'
>

const mockDb: jest.Mocked<MockDatabase> = {
  getFitnessRouteHeatmapByShareToken: vi.fn(),
  getFitnessRouteHeatmapSummaryByShareToken: vi.fn(),
  getFitnessRouteHeatmapPyramid: vi.fn(),
  getFitnessRouteHeatmapTilesByKeys: vi.fn()
}
let mockDatabase: MockDatabase | null = mockDb
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

describe('/embed/heatmap/[token]/tiles', () => {
  const TOKEN = 'share-token-1'
  const ACTOR_ID = 'https://llun.test/users/user1'
  const Z = 8
  const IN_X = 132
  const IN_Y = 85
  const OUT_X = 4
  const OUT_Y = 4

  const inTile = tileBounds(Z, IN_X, IN_Y)
  // A share scoped to the northern half of the in-region tile, in the stored
  // `rect:nwLat,nwLng,seLat,seLng` form.
  const HALF_TILE_REGION =
    `rect:${(inTile.maxLat + 1).toFixed(2)},${(inTile.minLng - 1).toFixed(2)},` +
    `${((inTile.minLat + inTile.maxLat) / 2).toFixed(2)},` +
    `${(inTile.maxLng + 1).toFixed(2)}`

  // Summary-shaped: no `bounds`, no `segments`. The route must never need them.
  const heatmap = (overrides: Record<string, unknown> = {}) => ({
    id: 'heatmap-1',
    actorId: ACTOR_ID,
    periodType: 'all_time',
    periodKey: 'all',
    region: HALF_TILE_REGION,
    status: 'completed',
    activityCount: 3,
    pointCount: 4,
    totalCount: 3,
    cursorOffset: 0,
    isPartial: false,
    shareToken: TOKEN,
    createdAt: 1,
    updatedAt: 2,
    ...overrides
  })

  const pyramid = (
    overrides: Partial<FitnessRouteHeatmapPyramid> = {}
  ): FitnessRouteHeatmapPyramid => ({
    id: 'pyramid-1',
    actorId: ACTOR_ID,
    status: 'completed',
    version: 5,
    claimSeq: 1,
    totalCount: 3,
    scannedCount: 3,
    activityCount: 3,
    tileCount: 2,
    pointCount: 8,
    createdAt: 1,
    updatedAt: 2,
    ...overrides
  })

  const tileRow = (x: number, y: number, segments: string, version = 5) => ({
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

  const request = (query: string, headers?: Record<string, string>) =>
    GET(
      new NextRequest(
        `http://llun.test/embed/heatmap/${TOKEN}/tiles?${query}`,
        {
          method: 'GET',
          headers
        }
      ),
      { params: Promise.resolve({ token: TOKEN }) }
    )

  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase = mockDb
    mockDb.getFitnessRouteHeatmapSummaryByShareToken.mockResolvedValue(
      heatmap() as never
    )
    mockDb.getFitnessRouteHeatmapPyramid.mockResolvedValue(pyramid())
    mockDb.getFitnessRouteHeatmapTilesByKeys.mockResolvedValue([])
  })

  describe('region clipping', () => {
    it('never reads a tile outside the shared region', async () => {
      const response = await request(
        `z=${Z}&tiles=${IN_X}:${IN_Y},${OUT_X}:${OUT_Y}&v=5`
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        version: 5,
        tiles: { [`${IN_X}:${IN_Y}`]: null, [`${OUT_X}:${OUT_Y}`]: null }
      })
      expect(mockDb.getFitnessRouteHeatmapTilesByKeys).toHaveBeenCalledWith({
        actorId: ACTOR_ID,
        tileKeys: [tileKey(Z, IN_X, IN_Y)]
      })
    })

    it('clips a boundary tile to the shared region instead of serving it whole', async () => {
      mockDb.getFitnessRouteHeatmapTilesByKeys.mockResolvedValue([
        tileRow(
          IN_X,
          IN_Y,
          encodeTile([{ count: 4, points: [0, 0, 8, 20, 16, 250, 24, 255] }])
        )
      ])

      const response = await request(`z=${Z}&tiles=${IN_X}:${IN_Y}&v=5`)
      const body = await response.json()
      expect(decodeTile(body.tiles[`${IN_X}:${IN_Y}`])).toEqual([
        { count: 4, points: [0, 0, 8, 20] }
      ])
    })

    it('serves a world-scoped share unclipped, which is what it is', async () => {
      const stored = encodeTile([{ count: 4, points: [0, 250, 8, 255] }])
      mockDb.getFitnessRouteHeatmapSummaryByShareToken.mockResolvedValue(
        heatmap({ region: '' }) as never
      )
      mockDb.getFitnessRouteHeatmapTilesByKeys.mockResolvedValue([
        tileRow(OUT_X, OUT_Y, stored)
      ])

      const response = await request(`z=${Z}&tiles=${OUT_X}:${OUT_Y}&v=5`)
      const body = await response.json()
      expect(decodeTile(body.tiles[`${OUT_X}:${OUT_Y}`])).toEqual([
        { count: 4, points: [0, 250, 8, 255] }
      ])
    })

    it('refuses a share whose stored region cannot be resolved, rather than serving the world', async () => {
      mockDb.getFitnessRouteHeatmapSummaryByShareToken.mockResolvedValue(
        heatmap({ region: 'rect:not-a-number,5,4,6' }) as never
      )

      const response = await request(`z=${Z}&tiles=${OUT_X}:${OUT_Y}&v=5`)
      expect(response.status).toBe(404)
      expect(mockDb.getFitnessRouteHeatmapTilesByKeys).not.toHaveBeenCalled()
    })
  })

  describe("the share's own scope", () => {
    it.each([
      {
        description: 'one sport',
        overrides: { activityType: 'Run' }
      },
      {
        description: 'one year',
        overrides: { periodType: 'yearly', periodKey: '2019' }
      },
      {
        description: 'one month',
        overrides: { periodType: 'monthly', periodKey: '2019-04' }
      }
    ])(
      'refuses a share scoped to $description rather than answering it from the whole history',
      async ({ overrides }) => {
        // The pyramid is per-ACTOR over every sport and all time. Serving it to
        // a share the owner cut down to one of those publishes all of them —
        // and the share's world-wide region means no clipping would catch it.
        mockDb.getFitnessRouteHeatmapSummaryByShareToken.mockResolvedValue(
          heatmap({ region: '', ...overrides }) as never
        )

        const response = await request(`z=${Z}&tiles=${OUT_X}:${OUT_Y}&v=5`)
        expect(response.status).toBe(404)
        expect(mockDb.getFitnessRouteHeatmapTilesByKeys).not.toHaveBeenCalled()
      }
    )

    it('reads the share without its geometry', async () => {
      // The full row carries the entire untiled heatmap; a panning viewport
      // would drag it off disk and through JSON.parse once per tile batch.
      await request(`z=${Z}&tiles=${IN_X}:${IN_Y}&v=5`)
      expect(
        mockDb.getFitnessRouteHeatmapSummaryByShareToken
      ).toHaveBeenCalledWith({ shareToken: TOKEN })
      expect(mockDb.getFitnessRouteHeatmapByShareToken).not.toHaveBeenCalled()
    })
  })

  describe('privacy', () => {
    it('strips the privacy class while keeping the geometry', async () => {
      mockDb.getFitnessRouteHeatmapSummaryByShareToken.mockResolvedValue(
        heatmap({ region: '' }) as never
      )
      mockDb.getFitnessRouteHeatmapTilesByKeys.mockResolvedValue([
        tileRow(
          OUT_X,
          OUT_Y,
          encodeTile([
            { count: 4, hidden: true, points: [0, 0, 8, 8] },
            { count: 1, points: [16, 16, 24, 24] }
          ])
        )
      ])

      const response = await request(`z=${Z}&tiles=${OUT_X}:${OUT_Y}&v=5`)
      const payload = (await response.json()).tiles[`${OUT_X}:${OUT_Y}`]
      expect(payload).not.toContain('"h"')
      expect(decodeTile(payload)).toEqual([
        { count: 4, points: [0, 0, 8, 8] },
        { count: 1, points: [16, 16, 24, 24] }
      ])
    })
  })

  describe('what it will not serve', () => {
    it('404s an unknown token', async () => {
      mockDb.getFitnessRouteHeatmapSummaryByShareToken.mockResolvedValue(null)
      expect((await request(`z=${Z}&tiles=${IN_X}:${IN_Y}`)).status).toBe(404)
      expect(mockDb.getFitnessRouteHeatmapPyramid).not.toHaveBeenCalled()
    })

    it.each([
      { description: 'a re-queued share', status: 'generating' },
      { description: 'a pending share', status: 'pending' },
      { description: 'a failed share', status: 'failed' }
    ])('404s $description', async ({ status }) => {
      mockDb.getFitnessRouteHeatmapSummaryByShareToken.mockResolvedValue(
        heatmap({ status }) as never
      )
      expect((await request(`z=${Z}&tiles=${IN_X}:${IN_Y}`)).status).toBe(404)
    })

    it.each([
      { description: 'no pyramid', value: null },
      {
        description: 'a build still running',
        value: pyramid({ status: 'generating' })
      },
      { description: 'a row that never built', value: pyramid({ version: 0 }) }
    ])('404s when the actor has $description', async ({ value }) => {
      mockDb.getFitnessRouteHeatmapPyramid.mockResolvedValue(value)
      const response = await request(`z=${Z}&tiles=${IN_X}:${IN_Y}`)
      expect(response.status).toBe(404)
      expect(mockDb.getFitnessRouteHeatmapTilesByKeys).not.toHaveBeenCalled()
    })

    it('500s when the database is unavailable', async () => {
      mockDatabase = null
      expect((await request(`z=${Z}&tiles=${IN_X}:${IN_Y}`)).status).toBe(500)
    })

    it.each([
      { description: 'a zoom off the ladder', query: 'z=9&tiles=1:1' },
      { description: 'no zoom', query: 'tiles=1:1' },
      { description: 'a non-numeric zoom', query: 'z=eight&tiles=1:1' },
      { description: 'no tiles', query: 'z=8' },
      { description: 'a malformed tile', query: 'z=8&tiles=1:' },
      { description: 'a tile past the zoom', query: 'z=4&tiles=16:0' }
    ])('400s for $description', async ({ query }) => {
      const response = await request(query)
      expect(response.status).toBe(400)
      expect(mockDb.getFitnessRouteHeatmapTilesByKeys).not.toHaveBeenCalled()
    })

    it('400s for more tiles than one request may ask for', async () => {
      const tiles = Array.from(
        { length: 129 },
        (_, index) => `${index}:0`
      ).join(',')
      expect((await request(`z=${Z}&tiles=${tiles}`)).status).toBe(400)
    })

    it('400s for a tiles parameter too long to be a legitimate batch', async () => {
      const response = await request(`z=${Z}&tiles=${'1'.repeat(2000)}`)
      expect(response.status).toBe(400)
    })
  })

  describe('caching', () => {
    it('is cacheable for five minutes and tagged with the pyramid version', async () => {
      const response = await request(`z=${Z}&tiles=${IN_X}:${IN_Y}&v=5`)
      expect(response.headers.get('Cache-Control')).toBe(
        'public, max-age=300, s-maxage=300'
      )
      expect(response.headers.get('ETag')).toBe('W/"5"')
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    })

    it('answers 304 for a matching validator without reading any tile', async () => {
      const response = await request(`z=${Z}&tiles=${IN_X}:${IN_Y}&v=5`, {
        'if-none-match': 'W/"5"'
      })
      expect(response.status).toBe(304)
      expect(response.headers.get('ETag')).toBe('W/"5"')
      expect(mockDb.getFitnessRouteHeatmapTilesByKeys).not.toHaveBeenCalled()
    })

    it('still refuses an unresolvable region when the validator matches', async () => {
      // The region resolver is the security boundary, so it must run ahead of
      // the conditional-request short-circuit: no response, 200 or 304, may be
      // produced without it having succeeded.
      mockDb.getFitnessRouteHeatmapSummaryByShareToken.mockResolvedValue(
        heatmap({ region: 'rect:not-a-number,5,4,6' }) as never
      )

      const response = await request(`z=${Z}&tiles=${IN_X}:${IN_Y}&v=5`, {
        'if-none-match': 'W/"5"'
      })
      expect(response.status).toBe(404)
    })

    it('serves a fresh body once the pyramid has been rebuilt under the validator', async () => {
      mockDb.getFitnessRouteHeatmapPyramid.mockResolvedValue(
        pyramid({ version: 6 })
      )
      const response = await request(`z=${Z}&tiles=${IN_X}:${IN_Y}&v=5`, {
        'if-none-match': 'W/"5"'
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('ETag')).toBe('W/"6"')
    })
  })
})
