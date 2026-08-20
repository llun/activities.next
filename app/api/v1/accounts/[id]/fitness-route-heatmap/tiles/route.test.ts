import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { MAX_TILES_PER_REQUEST } from '@/lib/services/fitness-files/heatmapTiles/constants'
import {
  encodeTile,
  tileKey
} from '@/lib/services/fitness-files/heatmapTiles/tileCodec'
import { tileBounds } from '@/lib/services/fitness-files/heatmapTiles/tileRegion'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { FitnessRouteHeatmapPyramid } from '@/lib/types/database/fitnessRouteHeatmapTile'

import { GET } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const mockGetActorFromSession = vi.fn()
vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: (...args: unknown[]) => mockGetActorFromSession(...args)
}))

type MockDatabase = Pick<
  Database,
  'getFitnessRouteHeatmapPyramid' | 'getFitnessRouteHeatmapTilesByKeys'
>

let mockDatabase: MockDatabase | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

describe('/api/v1/accounts/[id]/fitness-route-heatmap/tiles', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessRouteHeatmapPyramid: vi.fn(),
    getFitnessRouteHeatmapTilesByKeys: vi.fn()
  }

  const encodedId = ACTOR1_ID.replace('https://', '').replaceAll('/', ':')
  const baseUrl = `http://llun.test/api/v1/accounts/${encodedId}/fitness-route-heatmap/tiles`

  const Z = 8
  const IN_X = 132
  const IN_Y = 85
  const OUT_X = 4
  const OUT_Y = 4
  const inTile = tileBounds(Z, IN_X, IN_Y)
  // A rect around the in-region tile only, in the stored `rect:nwLat,nwLng,seLat,seLng` form.
  const REGION =
    `rect:${(inTile.maxLat + 1).toFixed(2)},${(inTile.minLng - 1).toFixed(2)},` +
    `${(inTile.minLat - 1).toFixed(2)},${(inTile.maxLng + 1).toFixed(2)}`

  const pyramid = (
    overrides: Partial<FitnessRouteHeatmapPyramid> = {}
  ): FitnessRouteHeatmapPyramid => ({
    id: 'pyramid-1',
    actorId: ACTOR1_ID,
    status: 'completed',
    version: 7,
    claimSeq: 1,
    totalCount: 3,
    scannedCount: 3,
    activityCount: 3,
    tileCount: 1,
    pointCount: 4,
    createdAt: 1,
    updatedAt: 2,
    ...overrides
  })

  const storedTile = encodeTile([{ count: 4, points: [0, 0, 8, 8] }])

  const request = (query: string) =>
    GET(new NextRequest(`${baseUrl}?${query}`, { method: 'GET' }), {
      params: Promise.resolve({ id: encodedId })
    })

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockGetActorFromSession.mockResolvedValue({ ...seedActor1, id: ACTOR1_ID })
    mockDb.getFitnessRouteHeatmapPyramid.mockResolvedValue(pyramid())
    mockDb.getFitnessRouteHeatmapTilesByKeys.mockResolvedValue([
      {
        actorId: ACTOR1_ID,
        tileKey: tileKey(Z, IN_X, IN_Y),
        z: Z,
        x: IN_X,
        y: IN_Y,
        version: 7,
        segments: storedTile,
        pointCount: 2,
        createdAt: 1,
        updatedAt: 2
      }
    ])
  })

  it('returns the requested tiles with the version they were built at', async () => {
    const response = await request(`z=${Z}&tiles=${IN_X}:${IN_Y}&v=7`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      version: 7,
      tiles: { [`${IN_X}:${IN_Y}`]: storedTile }
    })
  })

  it('serves the current tiles when the client asks for a version that has moved on', async () => {
    // A rebuild finishing between the heatmap read and the tile read must not
    // blank the map: the answer carries the version it actually has.
    const response = await request(`z=${Z}&tiles=${IN_X}:${IN_Y}&v=2`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      version: 7,
      tiles: { [`${IN_X}:${IN_Y}`]: storedTile }
    })
  })

  it('serves without a version parameter at all', async () => {
    const response = await request(`z=${Z}&tiles=${IN_X}:${IN_Y}`)
    expect(response.status).toBe(200)
    expect((await response.json()).version).toBe(7)
  })

  it('clips to the requested region and never reads what it excludes', async () => {
    const response = await request(
      `z=${Z}&tiles=${IN_X}:${IN_Y},${OUT_X}:${OUT_Y}&region=${encodeURIComponent(REGION)}`
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      version: 7,
      tiles: { [`${IN_X}:${IN_Y}`]: storedTile, [`${OUT_X}:${OUT_Y}`]: null }
    })
    expect(mockDb.getFitnessRouteHeatmapTilesByKeys).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      tileKeys: [tileKey(Z, IN_X, IN_Y)]
    })
  })

  it('reports no tiles when the pyramid has not completed a build', async () => {
    mockDb.getFitnessRouteHeatmapPyramid.mockResolvedValue(
      pyramid({ status: 'generating' })
    )
    const response = await request(`z=${Z}&tiles=${IN_X}:${IN_Y}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      version: 0,
      tiles: { [`${IN_X}:${IN_Y}`]: null }
    })
  })

  it('returns 500 when the database is unavailable', async () => {
    mockDatabase = null
    const response = await request(`z=${Z}&tiles=${IN_X}:${IN_Y}`)
    mockDatabase = mockDb
    expect(response.status).toBe(500)
  })

  it('returns 401 without a session', async () => {
    mockGetServerSession.mockResolvedValue(null)
    expect((await request(`z=${Z}&tiles=${IN_X}:${IN_Y}`)).status).toBe(401)
  })

  it('returns 401 when the session has no actor', async () => {
    mockGetActorFromSession.mockResolvedValue(null)
    expect((await request(`z=${Z}&tiles=${IN_X}:${IN_Y}`)).status).toBe(401)
  })

  it('returns 403 for another actor', async () => {
    mockGetActorFromSession.mockResolvedValue({
      ...seedActor1,
      id: 'https://llun.test/users/user2'
    })
    const response = await request(`z=${Z}&tiles=${IN_X}:${IN_Y}`)
    expect(response.status).toBe(403)
    expect(mockDb.getFitnessRouteHeatmapTilesByKeys).not.toHaveBeenCalled()
  })

  it.each([
    { description: 'a zoom off the ladder', query: 'z=9&tiles=1:1' },
    { description: 'a zoom past the ladder', query: 'z=18&tiles=1:1' },
    { description: 'a non-numeric zoom', query: 'z=eight&tiles=1:1' },
    { description: 'no zoom', query: 'tiles=1:1' },
    { description: 'no tiles', query: 'z=8' },
    { description: 'an empty tiles list', query: 'z=8&tiles=' },
    { description: 'a malformed tile', query: 'z=8&tiles=1:' },
    { description: 'a tile past the zoom', query: 'z=4&tiles=16:0' },
    { description: 'a negative version', query: 'z=8&tiles=1:1&v=-1' }
  ])('returns 400 for $description', async ({ query }) => {
    const response = await request(query)
    expect(response.status).toBe(400)
    expect(mockDb.getFitnessRouteHeatmapTilesByKeys).not.toHaveBeenCalled()
  })

  it('returns 400 for more tiles than one request may ask for', async () => {
    const tiles = Array.from(
      { length: MAX_TILES_PER_REQUEST + 1 },
      (_, index) => `${index}:0`
    ).join(',')
    const response = await request(`z=${Z}&tiles=${tiles}`)
    expect(response.status).toBe(400)
    expect(mockDb.getFitnessRouteHeatmapTilesByKeys).not.toHaveBeenCalled()
  })

  it('accepts exactly the maximum number of tiles', async () => {
    const tiles = Array.from(
      { length: MAX_TILES_PER_REQUEST },
      (_, index) => `${index}:0`
    ).join(',')
    const response = await request(`z=${Z}&tiles=${tiles}`)
    expect(response.status).toBe(200)
    expect(Object.keys((await response.json()).tiles)).toHaveLength(
      MAX_TILES_PER_REQUEST
    )
  })
})
