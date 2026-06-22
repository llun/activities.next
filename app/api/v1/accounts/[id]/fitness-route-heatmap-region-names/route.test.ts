import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { GET, PUT } from './route'

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
  'getFitnessRouteHeatmapRegionNames' | 'setFitnessRouteHeatmapRegionName'
>

let mockDatabase: MockDatabase | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

describe('GET/PUT /api/v1/accounts/[id]/fitness-route-heatmap-region-names', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessRouteHeatmapRegionNames: vi.fn(),
    setFitnessRouteHeatmapRegionName: vi.fn()
  }

  const encodedId = ACTOR1_ID.replace('https://', '').replaceAll('/', ':')
  const baseUrl = `http://llun.test/api/v1/accounts/${encodedId}/fitness-route-heatmap-region-names`

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockGetActorFromSession.mockResolvedValue({
      ...seedActor1,
      id: ACTOR1_ID
    })
    mockDb.getFitnessRouteHeatmapRegionNames.mockResolvedValue([])
    mockDb.setFitnessRouteHeatmapRegionName.mockResolvedValue()
  })

  it('returns the saved region names for the owner', async () => {
    mockDb.getFitnessRouteHeatmapRegionNames.mockResolvedValue([
      { region: 'rect:52.60,5.60,52.00,6.20', name: 'Veluwe loop' }
    ])

    const request = new NextRequest(baseUrl)
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      names: [{ region: 'rect:52.60,5.60,52.00,6.20', name: 'Veluwe loop' }]
    })
    expect(mockDb.getFitnessRouteHeatmapRegionNames).toHaveBeenCalledWith({
      actorId: ACTOR1_ID
    })
  })

  it('returns 403 for another actor on GET', async () => {
    mockGetActorFromSession.mockResolvedValue({
      ...seedActor1,
      id: 'https://llun.test/users/other'
    })

    const request = new NextRequest(baseUrl)
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(403)
    expect(mockDb.getFitnessRouteHeatmapRegionNames).not.toHaveBeenCalled()
  })

  it('saves a region name for the owner', async () => {
    const request = new NextRequest(baseUrl, {
      method: 'PUT',
      headers: {
        Origin: 'https://test.llun.dev',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        region: 'rect:52.60,5.60,52.00,6.20',
        name: '  Veluwe loop  '
      })
    })
    const response = await PUT(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(200)
    // Name is trimmed; region is normalized to its canonical form.
    expect(mockDb.setFitnessRouteHeatmapRegionName).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      region: 'rect:52.60,5.60,52.00,6.20',
      name: 'Veluwe loop'
    })
    await expect(response.json()).resolves.toEqual({
      region: 'rect:52.60,5.60,52.00,6.20',
      name: 'Veluwe loop'
    })
  })

  it('clears a region name when the name is blank', async () => {
    const request = new NextRequest(baseUrl, {
      method: 'PUT',
      headers: {
        Origin: 'https://test.llun.dev',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        region: 'rect:52.60,5.60,52.00,6.20',
        name: '   '
      })
    })
    const response = await PUT(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(200)
    expect(mockDb.setFitnessRouteHeatmapRegionName).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      region: 'rect:52.60,5.60,52.00,6.20',
      name: null
    })
  })

  it('rejects naming the world-wide region', async () => {
    const request = new NextRequest(baseUrl, {
      method: 'PUT',
      headers: {
        Origin: 'https://test.llun.dev',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ region: '', name: 'Everywhere' })
    })
    const response = await PUT(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(400)
    expect(mockDb.setFitnessRouteHeatmapRegionName).not.toHaveBeenCalled()
  })

  it('returns 403 when the PUT lacks same-origin proof', async () => {
    const request = new NextRequest(baseUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ region: 'rect:52.60,5.60,52.00,6.20', name: 'x' })
    })
    const response = await PUT(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(403)
    expect(mockDb.setFitnessRouteHeatmapRegionName).not.toHaveBeenCalled()
  })

  it('does not save a region name for another actor', async () => {
    mockGetActorFromSession.mockResolvedValue({
      ...seedActor1,
      id: 'https://llun.test/users/other'
    })

    const request = new NextRequest(baseUrl, {
      method: 'PUT',
      headers: {
        Origin: 'https://test.llun.dev',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ region: 'rect:52.60,5.60,52.00,6.20', name: 'x' })
    })
    const response = await PUT(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(403)
    expect(mockDb.setFitnessRouteHeatmapRegionName).not.toHaveBeenCalled()
  })

  it('canonicalizes a non-canonical region key before saving', async () => {
    const request = new NextRequest(baseUrl, {
      method: 'PUT',
      headers: {
        Origin: 'https://test.llun.dev',
        'Content-Type': 'application/json'
      },
      // High-precision coordinates that normalizeRegion rounds to 2 dp.
      body: JSON.stringify({
        region: 'rect:52.6011,5.6044,52.0000,6.2000',
        name: 'Veluwe loop'
      })
    })
    const response = await PUT(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(200)
    // The stored key (and the echoed region) is the canonical, rounded form so
    // it matches the key a heatmap's `region` uses.
    expect(mockDb.setFitnessRouteHeatmapRegionName).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      region: 'rect:52.60,5.60,52.00,6.20',
      name: 'Veluwe loop'
    })
    await expect(response.json()).resolves.toEqual({
      region: 'rect:52.60,5.60,52.00,6.20',
      name: 'Veluwe loop'
    })
  })

  it('rejects a region that normalizes to nothing (malformed input)', async () => {
    const request = new NextRequest(baseUrl, {
      method: 'PUT',
      headers: {
        Origin: 'https://test.llun.dev',
        'Content-Type': 'application/json'
      },
      // Unparseable region token — drops to the empty sentinel, not a real region.
      body: JSON.stringify({ region: 'not-a-region', name: 'x' })
    })
    const response = await PUT(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(400)
    expect(mockDb.setFitnessRouteHeatmapRegionName).not.toHaveBeenCalled()
  })

  it('returns 400 for a syntactically valid body that fails schema validation', async () => {
    const request = new NextRequest(baseUrl, {
      method: 'PUT',
      headers: {
        Origin: 'https://test.llun.dev',
        'Content-Type': 'application/json'
      },
      // `region` must be a string.
      body: JSON.stringify({ region: 123, name: 'x' })
    })
    const response = await PUT(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(400)
    expect(mockDb.setFitnessRouteHeatmapRegionName).not.toHaveBeenCalled()
  })

  it('returns 400 for a non-JSON body', async () => {
    const request = new NextRequest(baseUrl, {
      method: 'PUT',
      headers: {
        Origin: 'https://test.llun.dev',
        'Content-Type': 'application/json'
      },
      body: 'not json'
    })
    const response = await PUT(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(400)
    expect(mockDb.setFitnessRouteHeatmapRegionName).not.toHaveBeenCalled()
  })
})
