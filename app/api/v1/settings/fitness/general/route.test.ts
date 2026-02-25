import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { GET, POST } from './route'

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

describe('Fitness General Settings API', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessSettings: jest.fn(),
    createFitnessSettings: jest.fn(),
    updateFitnessSettings: jest.fn(),
    getAccountFromEmail: jest.fn(),
    getActorsForAccount: jest.fn(),
    getActorFromId: jest.fn()
  }

  beforeAll(async () => {
    mockDatabase = mockDb
  })

  beforeEach(async () => {
    mockGetServerSession.mockReset()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })

    jest.clearAllMocks()

    mockDb.getFitnessSettings.mockResolvedValue(null)
    mockDb.createFitnessSettings.mockResolvedValue({
      id: 'general-settings-id',
      actorId: ACTOR1_ID,
      serviceType: 'general',
      privacyLocations: [],
      privacyHideRadiusMeters: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    mockDb.updateFitnessSettings.mockResolvedValue({
      id: 'general-settings-id',
      actorId: ACTOR1_ID,
      serviceType: 'general',
      privacyLocations: [],
      privacyHideRadiusMeters: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
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

  describe('GET /api/v1/settings/fitness/general', () => {
    it('returns default values when no settings exist', async () => {
      const request = new NextRequest(
        'http://llun.test/api/v1/settings/fitness/general',
        {
          method: 'GET'
        }
      )

      const response = await GET(request, { params: Promise.resolve({}) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.privacyLocations).toEqual([])
      expect(data.privacyHomeLatitude).toBeNull()
      expect(data.privacyHomeLongitude).toBeNull()
      expect(data.privacyHideRadiusMeters).toBe(0)
    })

    it('returns saved privacy settings when configured', async () => {
      mockDb.getFitnessSettings.mockResolvedValue({
        id: 'general-settings-id',
        actorId: ACTOR1_ID,
        serviceType: 'general',
        privacyLocations: [
          {
            latitude: 13.7563,
            longitude: 100.5018,
            hideRadiusMeters: 20
          }
        ],
        privacyHomeLatitude: 13.7563,
        privacyHomeLongitude: 100.5018,
        privacyHideRadiusMeters: 20,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })

      const request = new NextRequest(
        'http://llun.test/api/v1/settings/fitness/general',
        {
          method: 'GET'
        }
      )

      const response = await GET(request, { params: Promise.resolve({}) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.privacyLocations).toEqual([
        {
          latitude: 13.7563,
          longitude: 100.5018,
          hideRadiusMeters: 20
        }
      ])
      expect(data.privacyHomeLatitude).toBe(13.7563)
      expect(data.privacyHomeLongitude).toBe(100.5018)
      expect(data.privacyHideRadiusMeters).toBe(20)
    })
  })

  describe('POST /api/v1/settings/fitness/general', () => {
    it('saves valid privacy settings', async () => {
      mockDb.createFitnessSettings.mockResolvedValue({
        id: 'general-settings-id',
        actorId: ACTOR1_ID,
        serviceType: 'general',
        privacyHomeLatitude: 13.7563,
        privacyHomeLongitude: 100.5018,
        privacyHideRadiusMeters: 10,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })

      const request = new NextRequest(
        'http://llun.test/api/v1/settings/fitness/general',
        {
          method: 'POST',
          body: JSON.stringify({
            privacyHomeLatitude: 13.7563,
            privacyHomeLongitude: 100.5018,
            privacyHideRadiusMeters: 10
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
          serviceType: 'general',
          privacyLocations: [
            {
              latitude: 13.7563,
              longitude: 100.5018,
              hideRadiusMeters: 10
            }
          ],
          privacyHomeLatitude: 13.7563,
          privacyHomeLongitude: 100.5018,
          privacyHideRadiusMeters: 10
        })
      )
    })

    it('saves multiple privacy locations using the list payload', async () => {
      mockDb.createFitnessSettings.mockResolvedValue({
        id: 'general-settings-id',
        actorId: ACTOR1_ID,
        serviceType: 'general',
        privacyLocations: [
          {
            latitude: 13.7563,
            longitude: 100.5018,
            hideRadiusMeters: 20
          },
          {
            latitude: 35.6764,
            longitude: 139.65,
            hideRadiusMeters: 10
          }
        ],
        privacyHomeLatitude: 13.7563,
        privacyHomeLongitude: 100.5018,
        privacyHideRadiusMeters: 20,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })

      const request = new NextRequest(
        'http://llun.test/api/v1/settings/fitness/general',
        {
          method: 'POST',
          body: JSON.stringify({
            privacyLocations: [
              {
                latitude: 13.7563,
                longitude: 100.5018,
                hideRadiusMeters: 20
              },
              {
                latitude: 35.6764,
                longitude: 139.65,
                hideRadiusMeters: 10
              }
            ]
          })
        }
      )

      const response = await POST(request, { params: Promise.resolve({}) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.privacyLocations).toHaveLength(2)
      expect(mockDb.createFitnessSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: ACTOR1_ID,
          serviceType: 'general',
          privacyLocations: [
            {
              latitude: 13.7563,
              longitude: 100.5018,
              hideRadiusMeters: 20
            },
            {
              latitude: 35.6764,
              longitude: 139.65,
              hideRadiusMeters: 10
            }
          ],
          privacyHomeLatitude: 13.7563,
          privacyHomeLongitude: 100.5018,
          privacyHideRadiusMeters: 20
        })
      )
    })

    it('clears all privacy locations with an empty list payload', async () => {
      mockDb.getFitnessSettings.mockResolvedValue({
        id: 'general-settings-id',
        actorId: ACTOR1_ID,
        serviceType: 'general',
        privacyLocations: [
          {
            latitude: 13.7563,
            longitude: 100.5018,
            hideRadiusMeters: 20
          }
        ],
        privacyHomeLatitude: 13.7563,
        privacyHomeLongitude: 100.5018,
        privacyHideRadiusMeters: 20,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
      mockDb.updateFitnessSettings.mockResolvedValue({
        id: 'general-settings-id',
        actorId: ACTOR1_ID,
        serviceType: 'general',
        privacyLocations: [],
        privacyHideRadiusMeters: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })

      const request = new NextRequest(
        'http://llun.test/api/v1/settings/fitness/general',
        {
          method: 'POST',
          body: JSON.stringify({
            privacyLocations: []
          })
        }
      )

      const response = await POST(request, { params: Promise.resolve({}) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.privacyLocations).toEqual([])
      expect(mockDb.updateFitnessSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'general-settings-id',
          privacyLocations: [],
          privacyHomeLatitude: null,
          privacyHomeLongitude: null,
          privacyHideRadiusMeters: 0
        })
      )
    })

    it('prioritizes privacyLocations when list and legacy fields are both sent', async () => {
      mockDb.createFitnessSettings.mockResolvedValue({
        id: 'general-settings-id',
        actorId: ACTOR1_ID,
        serviceType: 'general',
        privacyLocations: [
          {
            latitude: 13.7563,
            longitude: 100.5018,
            hideRadiusMeters: 20
          },
          {
            latitude: 35.6764,
            longitude: 139.65,
            hideRadiusMeters: 10
          }
        ],
        privacyHomeLatitude: 13.7563,
        privacyHomeLongitude: 100.5018,
        privacyHideRadiusMeters: 20,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })

      const request = new NextRequest(
        'http://llun.test/api/v1/settings/fitness/general',
        {
          method: 'POST',
          body: JSON.stringify({
            privacyLocations: [
              {
                latitude: 13.7563,
                longitude: 100.5018,
                hideRadiusMeters: 20
              },
              {
                latitude: 35.6764,
                longitude: 139.65,
                hideRadiusMeters: 10
              }
            ],
            privacyHomeLatitude: 1,
            privacyHomeLongitude: 2,
            privacyHideRadiusMeters: 5
          })
        }
      )

      const response = await POST(request, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(mockDb.createFitnessSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: ACTOR1_ID,
          serviceType: 'general',
          privacyLocations: [
            {
              latitude: 13.7563,
              longitude: 100.5018,
              hideRadiusMeters: 20
            },
            {
              latitude: 35.6764,
              longitude: 139.65,
              hideRadiusMeters: 10
            }
          ],
          privacyHomeLatitude: 13.7563,
          privacyHomeLongitude: 100.5018,
          privacyHideRadiusMeters: 20
        })
      )
    })

    it('rejects request when only one coordinate is provided', async () => {
      const request = new NextRequest(
        'http://llun.test/api/v1/settings/fitness/general',
        {
          method: 'POST',
          body: JSON.stringify({
            privacyHomeLatitude: 13.7563,
            privacyHomeLongitude: null,
            privacyHideRadiusMeters: 0
          })
        }
      )

      const response = await POST(request, { params: Promise.resolve({}) })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('Latitude and longitude')
    })

    it('rejects privacy radius without a home location', async () => {
      const request = new NextRequest(
        'http://llun.test/api/v1/settings/fitness/general',
        {
          method: 'POST',
          body: JSON.stringify({
            privacyHomeLatitude: null,
            privacyHomeLongitude: null,
            privacyHideRadiusMeters: 20
          })
        }
      )

      const response = await POST(request, { params: Promise.resolve({}) })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('home location')
    })
  })
})
