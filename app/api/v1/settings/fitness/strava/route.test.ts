import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { DELETE, GET, POST } from './route'

const mockGetServerSession = jest.fn()
jest.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args)
}))

jest.mock('@/app/api/auth/[...nextauth]/authOptions', () => ({
  getAuthOptions: jest.fn(() => ({}))
}))

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn().mockReturnValue({
    host: 'llun.test',
    secretPhase: 'test-secret-for-encryption',
    allowEmails: [],
    allowActorDomains: []
  })
}))

type MockDatabase = Pick<
  Database,
  | 'getFitnessSettings'
  | 'createFitnessSettings'
  | 'deleteFitnessSettings'
  | 'updateFitnessSettings'
  | 'getAccountFromEmail'
  | 'getActorsForAccount'
  | 'getActorFromId'
>

let mockDatabase: MockDatabase | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: () => undefined
  })
}))

const mockGetSubscription = jest.fn()
const mockDeleteSubscription = jest.fn()
jest.mock('@/lib/services/strava/webhookSubscription', () => ({
  getSubscription: (...args: unknown[]) => mockGetSubscription(...args),
  deleteSubscription: (...args: unknown[]) => mockDeleteSubscription(...args),
  createSubscription: jest.fn(),
  ensureWebhookSubscription: jest.fn().mockResolvedValue({ success: true })
}))

describe('Strava Settings API', () => {
  // Mock database object
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessSettings: jest.fn(),
    createFitnessSettings: jest.fn(),
    deleteFitnessSettings: jest.fn(),
    updateFitnessSettings: jest.fn(),
    getAccountFromEmail: jest.fn(),
    getActorsForAccount: jest.fn(),
    getActorFromId: jest.fn()
  }

  beforeAll(async () => {
    mockDatabase = mockDb
  })

  afterAll(async () => {
    // No cleanup needed for mock
  })

  beforeEach(async () => {
    mockGetServerSession.mockReset()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })

    // Reset mocks
    jest.clearAllMocks()

    // Default mock implementations
    mockDb.getFitnessSettings.mockResolvedValue(null)
    mockDb.createFitnessSettings.mockResolvedValue({})
    mockDb.deleteFitnessSettings.mockResolvedValue(undefined)
    mockDb.updateFitnessSettings.mockResolvedValue({})
    mockDb.getAccountFromEmail.mockResolvedValue({
      id: 'account-1',
      email: seedActor1.email,
      defaultActorId: ACTOR1_ID
    })
    mockDb.getActorsForAccount.mockResolvedValue([
      { ...seedActor1, id: ACTOR1_ID }
    ])
    mockDb.getActorFromId.mockResolvedValue({
      ...seedActor1,
      id: ACTOR1_ID
    })
  })

  describe('GET /api/v1/settings/fitness/strava', () => {
    it('returns configured: false when no settings exist', async () => {
      mockDb.getFitnessSettings.mockResolvedValue(null)

      const request = new NextRequest(
        'http://llun.test/api/v1/settings/fitness/strava',
        {
          method: 'GET'
        }
      )

      const response = await GET(request, { params: Promise.resolve({}) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.configured).toBe(false)
    })

    it('returns clientId without secret when configured', async () => {
      mockDb.getFitnessSettings.mockResolvedValue({
        actorId: ACTOR1_ID,
        serviceType: 'strava',
        clientId: '12345',
        clientSecret: 'secret123'
      })

      const request = new NextRequest(
        'http://llun.test/api/v1/settings/fitness/strava',
        {
          method: 'GET'
        }
      )

      const response = await GET(request, { params: Promise.resolve({}) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.configured).toBe(true)
      expect(data.clientId).toBe('12345')
      expect(data.clientSecret).toBeUndefined()
    })
  })

  describe('POST /api/v1/settings/fitness/strava', () => {
    it('saves valid Strava settings', async () => {
      mockDb.getFitnessSettings.mockResolvedValue(null)

      const request = new NextRequest(
        'http://llun.test/api/v1/settings/fitness/strava',
        {
          method: 'POST',
          body: JSON.stringify({
            clientId: '54321',
            clientSecret: 'newsecret456'
          })
        }
      )

      const response = await POST(request, { params: Promise.resolve({}) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)

      expect(mockDb.createFitnessSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: ACTOR1_ID,
          serviceType: 'strava',
          clientId: '54321',
          clientSecret: 'newsecret456'
        })
      )
    })

    it('rejects non-numeric client ID', async () => {
      const request = new NextRequest(
        'http://llun.test/api/v1/settings/fitness/strava',
        {
          method: 'POST',
          body: JSON.stringify({
            clientId: 'abc123',
            clientSecret: 'secret'
          })
        }
      )

      const response = await POST(request, { params: Promise.resolve({}) })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('numeric')
    })

    it('rejects empty client secret', async () => {
      const request = new NextRequest(
        'http://llun.test/api/v1/settings/fitness/strava',
        {
          method: 'POST',
          body: JSON.stringify({
            clientId: '12345',
            clientSecret: ''
          })
        }
      )

      const response = await POST(request, { params: Promise.resolve({}) })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBeDefined()
    })
  })

  describe('DELETE /api/v1/settings/fitness/strava', () => {
    it('removes existing Strava settings', async () => {
      mockDb.getFitnessSettings.mockResolvedValue({
        actorId: ACTOR1_ID,
        serviceType: 'strava',
        clientId: '99999',
        clientSecret: 'deleteme'
      })

      mockGetSubscription.mockResolvedValueOnce({
        id: 12345
      })

      const request = new NextRequest(
        'http://llun.test/api/v1/settings/fitness/strava',
        {
          method: 'DELETE'
        }
      )

      const response = await DELETE(request, { params: Promise.resolve({}) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)

      // Verified delete was called
      expect(mockDb.deleteFitnessSettings).toHaveBeenCalledWith({
        actorId: ACTOR1_ID,
        serviceType: 'strava'
      })

      // Verify webhook logic
      expect(mockGetSubscription).toHaveBeenCalledWith('99999', 'deleteme')
      expect(mockDeleteSubscription).toHaveBeenCalledWith(
        '99999',
        'deleteme',
        12345
      )
    })

    it('returns 404 when no settings exist', async () => {
      mockDb.getFitnessSettings.mockResolvedValue(null)

      const request = new NextRequest(
        'http://llun.test/api/v1/settings/fitness/strava',
        {
          method: 'DELETE'
        }
      )

      const response = await DELETE(request, { params: Promise.resolve({}) })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toContain('No Strava settings')
    })
  })
})
