import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'

import { GET } from './route'

const mockGetServerSession = jest.fn()
jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn().mockReturnValue({
    host: 'llun.test',
    allowEmails: []
  })
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

const mockGetMedia = jest.fn()
jest.mock('@/lib/services/medias', () => ({
  getMedia: (...args: unknown[]) => mockGetMedia(...args)
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: () => undefined
  })
}))

describe('GET /api/v1/fitness-files/heatmap-image/[id]', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetMedia.mockResolvedValue({
      type: 'buffer',
      contentType: 'image/png',
      buffer: Buffer.from('fake-png-data')
    })
  })

  const createRequest = () =>
    new NextRequest(
      'https://llun.test/api/v1/fitness-files/heatmap-image/heatmap-id',
      { method: 'GET' }
    )

  it('returns 404 when heatmap does not exist', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'nonexistent-id' })
    })

    expect(response.status).toBe(404)
  })

  it('returns 404 when heatmap has no imagePath', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })

    const heatmap = await database.createFitnessHeatmap({
      actorId: ACTOR1_ID,
      periodType: 'all_time',
      periodKey: 'all'
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: heatmap.id })
    })

    expect(response.status).toBe(404)
  })

  it('returns 401 when user is not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const heatmap = await database.createFitnessHeatmap({
      actorId: ACTOR1_ID,
      periodType: 'yearly',
      periodKey: '2024'
    })
    await database.updateFitnessHeatmapStatus({
      id: heatmap.id,
      status: 'completed',
      imagePath: 'heatmaps/test-image.png'
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: heatmap.id })
    })

    expect(response.status).toBe(401)
  })

  it('returns 403 when user does not own the heatmap', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })

    const heatmap = await database.createFitnessHeatmap({
      actorId: ACTOR1_ID,
      periodType: 'monthly',
      periodKey: '2024-06'
    })
    await database.updateFitnessHeatmapStatus({
      id: heatmap.id,
      status: 'completed',
      imagePath: 'heatmaps/forbidden-image.png'
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: heatmap.id })
    })

    expect(response.status).toBe(403)
  })

  it('serves the heatmap image for the owner', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })

    const heatmap = await database.createFitnessHeatmap({
      actorId: ACTOR1_ID,
      periodType: 'yearly',
      periodKey: '2024-serve'
    })
    await database.updateFitnessHeatmapStatus({
      id: heatmap.id,
      status: 'completed',
      imagePath: 'heatmaps/owner-image.png'
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: heatmap.id })
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('Cache-Control')).toBe('private, no-cache')
    expect(mockGetMedia).toHaveBeenCalledWith(
      expect.anything(),
      'heatmaps/owner-image.png'
    )
  })

  it('returns 404 when storage file is missing', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockGetMedia.mockResolvedValue(null)

    const heatmap = await database.createFitnessHeatmap({
      actorId: ACTOR1_ID,
      periodType: 'monthly',
      periodKey: '2024-07-missing'
    })
    await database.updateFitnessHeatmapStatus({
      id: heatmap.id,
      status: 'completed',
      imagePath: 'heatmaps/missing-image.png'
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: heatmap.id })
    })

    expect(response.status).toBe(404)
  })
})
