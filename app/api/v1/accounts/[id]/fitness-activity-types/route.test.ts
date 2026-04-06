import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { GET } from './route'

const mockGetServerSession = jest.fn()
jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const mockGetActorFromSession = jest.fn()
jest.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: (...args: unknown[]) => mockGetActorFromSession(...args)
}))

type MockDatabase = Pick<Database, 'getDistinctActivityTypesForActor'>

let mockDatabase: MockDatabase | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

describe('GET /api/v1/accounts/[id]/fitness-activity-types', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getDistinctActivityTypesForActor: jest.fn()
  }

  const encodedId = ACTOR1_ID.replace('https://', '').replaceAll('/', ':')
  const baseUrl = `http://llun.test/api/v1/accounts/${encodedId}/fitness-activity-types`

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockGetActorFromSession.mockResolvedValue({
      ...seedActor1,
      id: ACTOR1_ID
    })
  })

  it('returns 401 when not logged in', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const request = new NextRequest(baseUrl)
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })
    expect(response.status).toBe(401)
  })

  it('returns 401 when session has no actor', async () => {
    mockGetActorFromSession.mockResolvedValue(null)

    const request = new NextRequest(baseUrl)
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })
    expect(response.status).toBe(401)
  })

  it('returns 403 when requesting another actors data', async () => {
    mockGetActorFromSession.mockResolvedValue({
      ...seedActor1,
      id: 'https://llun.test/users/other'
    })

    const request = new NextRequest(baseUrl)
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })
    expect(response.status).toBe(403)
  })

  it('returns 200 with activity types', async () => {
    const activityTypes = ['cycling', 'hiking', 'running']
    mockDb.getDistinctActivityTypesForActor.mockResolvedValue(activityTypes)

    const request = new NextRequest(baseUrl)
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual(['cycling', 'hiking', 'running'])

    expect(mockDb.getDistinctActivityTypesForActor).toHaveBeenCalledWith({
      actorId: ACTOR1_ID
    })
  })

  it('returns 200 with empty array when no activity types', async () => {
    mockDb.getDistinctActivityTypesForActor.mockResolvedValue([])

    const request = new NextRequest(baseUrl)
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual([])
  })

  it('returns 500 when database is not available', async () => {
    mockDatabase = null

    const request = new NextRequest(baseUrl)
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })
    expect(response.status).toBe(500)

    mockDatabase = mockDb
  })
})
