import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { FitnessGear } from '@/lib/types/database/fitnessGear'

import { GET, POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    secretPhase: 'test-secret-for-encryption',
    allowEmails: [],
    allowActorDomains: []
  })
}))

type MockDatabase = Pick<
  Database,
  | 'getFitnessGearsByActor'
  | 'getFitnessGearDistanceRollups'
  | 'getFitnessGearDeviceRollups'
  | 'createFitnessGear'
  | 'getAccountFromEmail'
  | 'getActorsForAccount'
  | 'getActorFromId'
>

let mockDatabase: MockDatabase | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined })
}))

const gear = (overrides: Partial<FitnessGear> = {}): FitnessGear => ({
  id: 'gear-1',
  actorId: ACTOR1_ID,
  kind: 'bike',
  name: 'Moots',
  defaultSports: ['ride'],
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides
})

describe('Fitness gear collection API', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessGearsByActor: vi.fn(),
    getFitnessGearDistanceRollups: vi.fn(),
    getFitnessGearDeviceRollups: vi.fn(),
    createFitnessGear: vi.fn(),
    getAccountFromEmail: vi.fn(),
    getActorsForAccount: vi.fn(),
    getActorFromId: vi.fn()
  }

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockDb.getAccountFromEmail.mockResolvedValue({
      id: 'account-1',
      email: seedActor1.email,
      defaultActorId: ACTOR1_ID
    })
    mockDb.getActorsForAccount.mockResolvedValue([
      { ...seedActor1, id: ACTOR1_ID }
    ])
    mockDb.getActorFromId.mockResolvedValue({ ...seedActor1, id: ACTOR1_ID })
    mockDb.getFitnessGearsByActor.mockResolvedValue([])
    mockDb.getFitnessGearDistanceRollups.mockResolvedValue({})
    mockDb.getFitnessGearDeviceRollups.mockResolvedValue({})
  })

  const postRequest = (body: unknown) =>
    new NextRequest('http://llun.test/api/v1/fitness/gear', {
      method: 'POST',
      headers: { Origin: 'https://llun.test' },
      body: JSON.stringify(body)
    })

  describe('GET', () => {
    it('returns each gear with its derived distance and activity count', async () => {
      mockDb.getFitnessGearsByActor.mockResolvedValue([gear()])
      mockDb.getFitnessGearDistanceRollups.mockResolvedValue({
        'gear-1': { distanceMeters: 106_400, activityCount: 2 }
      })

      const response = await GET(
        new NextRequest('http://llun.test/api/v1/fitness/gear', {
          method: 'GET'
        }),
        { params: Promise.resolve({}) }
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.gear).toHaveLength(1)
      expect(data.gear[0]).toMatchObject({
        id: 'gear-1',
        name: 'Moots',
        distanceMeters: 106_400,
        activityCount: 2
      })
    })

    it('resolves every rollup in a single batched call', async () => {
      mockDb.getFitnessGearsByActor.mockResolvedValue([
        gear({ id: 'gear-1' }),
        gear({ id: 'gear-2' }),
        gear({ id: 'gear-3' })
      ])

      await GET(
        new NextRequest('http://llun.test/api/v1/fitness/gear', {
          method: 'GET'
        }),
        { params: Promise.resolve({}) }
      )

      expect(mockDb.getFitnessGearDistanceRollups).toHaveBeenCalledTimes(1)
      expect(mockDb.getFitnessGearDistanceRollups).toHaveBeenCalledWith({
        actorId: ACTOR1_ID,
        gearIds: ['gear-1', 'gear-2', 'gear-3']
      })
    })

    it('rolls devices up separately from bikes and shoes', async () => {
      // A device records rides and runs alike, so summing their distances would
      // report a number that means nothing. It reports a count and a first-used
      // date instead — and the two rollups still cost one query each, not one
      // per gear.
      mockDb.getFitnessGearsByActor.mockResolvedValue([
        gear({ id: 'gear-1' }),
        gear({ id: 'device-1', kind: 'device', name: 'Garmin Edge 840' })
      ])
      mockDb.getFitnessGearDistanceRollups.mockResolvedValue({
        'gear-1': { distanceMeters: 106_400, activityCount: 2 }
      })
      mockDb.getFitnessGearDeviceRollups.mockResolvedValue({
        'device-1': { activityCount: 41, firstUsedAt: 1_600_000_000_000 }
      })

      const response = await GET(
        new NextRequest('http://llun.test/api/v1/fitness/gear', {
          method: 'GET'
        }),
        { params: Promise.resolve({}) }
      )
      const data = await response.json()

      expect(mockDb.getFitnessGearDistanceRollups).toHaveBeenCalledWith({
        actorId: ACTOR1_ID,
        gearIds: ['gear-1']
      })
      expect(mockDb.getFitnessGearDeviceRollups).toHaveBeenCalledTimes(1)
      expect(mockDb.getFitnessGearDeviceRollups).toHaveBeenCalledWith({
        actorId: ACTOR1_ID,
        gearIds: ['device-1']
      })
      expect(data.gear[0]).toMatchObject({
        distanceMeters: 106_400,
        activityCount: 2,
        firstUsedAt: null
      })
      expect(data.gear[1]).toMatchObject({
        kind: 'device',
        distanceMeters: 0,
        activityCount: 41,
        firstUsedAt: 1_600_000_000_000
      })
    })

    it('reports zero for gear with no activities', async () => {
      mockDb.getFitnessGearsByActor.mockResolvedValue([gear()])
      mockDb.getFitnessGearDistanceRollups.mockResolvedValue({})

      const response = await GET(
        new NextRequest('http://llun.test/api/v1/fitness/gear', {
          method: 'GET'
        }),
        { params: Promise.resolve({}) }
      )
      const data = await response.json()
      expect(data.gear[0]).toMatchObject({
        distanceMeters: 0,
        activityCount: 0
      })
    })
  })

  describe('POST', () => {
    it('creates gear and returns it with zeroed totals', async () => {
      mockDb.createFitnessGear.mockResolvedValue(gear())

      const response = await POST(
        postRequest({ kind: 'bike', name: 'Moots', defaultSports: ['ride'] }),
        { params: Promise.resolve({}) }
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.gear).toMatchObject({
        name: 'Moots',
        distanceMeters: 0,
        activityCount: 0
      })
      expect(mockDb.createFitnessGear).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: ACTOR1_ID,
          kind: 'bike',
          name: 'Moots',
          defaultSports: ['ride']
        })
      )
    })

    it.each([
      {
        description: 'the name is missing',
        body: { kind: 'bike' }
      },
      {
        description: 'the kind is not a gear kind',
        body: { kind: 'skis', name: 'Skis' }
      },
      {
        description: 'a default sport is not a known key',
        body: { kind: 'bike', name: 'Moots', defaultSports: ['skiing'] }
      },
      {
        description: 'the weight is negative',
        body: { kind: 'bike', name: 'Moots', weightKilograms: -1 }
      }
    ])('rejects with 422 when $description', async ({ body }) => {
      const response = await POST(postRequest(body), {
        params: Promise.resolve({})
      })
      expect(response.status).toBe(422)
      expect(mockDb.createFitnessGear).not.toHaveBeenCalled()
    })

    it.each([
      {
        description: 'a bike is given a shoes distance alert',
        body: { kind: 'bike', name: 'Moots', alertDistanceMeters: 650_000 }
      },
      {
        description: 'shoes are given a frame type',
        body: { kind: 'shoes', name: 'Cloud', bikeType: 'Road bike' }
      },
      {
        description: 'shoes are given a weight',
        body: { kind: 'shoes', name: 'Cloud', weightKilograms: 0.3 }
      },
      {
        description: 'a bike claims a running sport',
        body: { kind: 'bike', name: 'Moots', defaultSports: ['run'] }
      },
      {
        description: 'shoes claim a cycling sport',
        body: { kind: 'shoes', name: 'Cloud', defaultSports: ['gravel_ride'] }
      }
    ])('rejects with 422 when $description', async ({ body }) => {
      const response = await POST(postRequest(body), {
        params: Promise.resolve({})
      })
      expect(response.status).toBe(422)
      expect(mockDb.createFitnessGear).not.toHaveBeenCalled()
    })

    it('rejects a malformed body with 400', async () => {
      const response = await POST(
        new NextRequest('http://llun.test/api/v1/fitness/gear', {
          method: 'POST',
          headers: { Origin: 'https://llun.test' },
          body: 'not json'
        }),
        { params: Promise.resolve({}) }
      )
      expect(response.status).toBe(400)
    })

    it('rejects a cross-site request with 403', async () => {
      const response = await POST(
        new NextRequest('http://llun.test/api/v1/fitness/gear', {
          method: 'POST',
          headers: { Origin: 'https://evil.test' },
          body: JSON.stringify({ kind: 'bike', name: 'Moots' })
        }),
        { params: Promise.resolve({}) }
      )
      expect(response.status).toBe(403)
      expect(mockDb.createFitnessGear).not.toHaveBeenCalled()
    })
  })
})
