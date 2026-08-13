import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { FitnessGear } from '@/lib/types/database/fitnessGear'

import { DELETE, PATCH } from './route'

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
  | 'getFitnessGear'
  | 'updateFitnessGear'
  | 'deleteFitnessGear'
  | 'getFitnessGearDistanceRollups'
  | 'getFitnessGearDeviceRollups'
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
  defaultSports: [],
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides
})

describe('Fitness gear item API', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessGear: vi.fn(),
    updateFitnessGear: vi.fn(),
    deleteFitnessGear: vi.fn(),
    getFitnessGearDistanceRollups: vi.fn(),
    getFitnessGearDeviceRollups: vi.fn(),
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
    mockDb.getFitnessGearDistanceRollups.mockResolvedValue({})
    mockDb.getFitnessGearDeviceRollups.mockResolvedValue({})
  })

  const patchRequest = (body: unknown) =>
    new NextRequest('http://llun.test/api/v1/fitness/gear/gear-1', {
      method: 'PATCH',
      headers: { Origin: 'https://llun.test' },
      body: JSON.stringify(body)
    })

  const params = { params: Promise.resolve({ id: 'gear-1' }) }

  describe('PATCH', () => {
    it('updates the gear and returns it with a fresh rollup', async () => {
      mockDb.getFitnessGear.mockResolvedValue(gear())
      mockDb.updateFitnessGear.mockResolvedValue(gear({ name: 'Renamed' }))
      mockDb.getFitnessGearDistanceRollups.mockResolvedValue({
        'gear-1': { distanceMeters: 5000, activityCount: 1 }
      })

      const response = await PATCH(patchRequest({ name: 'Renamed' }), params)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.gear).toMatchObject({
        name: 'Renamed',
        distanceMeters: 5000
      })
      expect(mockDb.updateFitnessGear).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'gear-1', actorId: ACTOR1_ID })
      )
    })

    it('answers 404 for gear the actor does not own', async () => {
      mockDb.getFitnessGear.mockResolvedValue(null)

      const response = await PATCH(patchRequest({ name: 'Renamed' }), params)

      expect(response.status).toBe(404)
      expect(mockDb.updateFitnessGear).not.toHaveBeenCalled()
    })

    it('validates kind-scoped fields against the stored kind', async () => {
      mockDb.getFitnessGear.mockResolvedValue(gear({ kind: 'shoes' }))

      const response = await PATCH(
        patchRequest({ bikeType: 'Road bike' }),
        params
      )

      expect(response.status).toBe(422)
      expect(mockDb.updateFitnessGear).not.toHaveBeenCalled()
    })

    it('rejects a default sport belonging to the other kind', async () => {
      mockDb.getFitnessGear.mockResolvedValue(gear({ kind: 'bike' }))

      const response = await PATCH(
        patchRequest({ defaultSports: ['trail_run'] }),
        params
      )

      expect(response.status).toBe(422)
    })

    it('rejects a malformed body with 400', async () => {
      const response = await PATCH(
        new NextRequest('http://llun.test/api/v1/fitness/gear/gear-1', {
          method: 'PATCH',
          headers: { Origin: 'https://llun.test' },
          body: 'not json'
        }),
        params
      )
      expect(response.status).toBe(400)
    })

    describe('a recording device', () => {
      const device = () =>
        gear({
          kind: 'device',
          name: 'Garmin Edge 840',
          deviceKey: 'name:garmin edge 840',
          productUrl: 'https://www.garmin.com'
        })

      it('accepts a product page and reads back the device rollup', async () => {
        mockDb.getFitnessGear.mockResolvedValue(device())
        mockDb.updateFitnessGear.mockResolvedValue(
          gear({
            ...device(),
            name: 'the Edge',
            productUrl: 'https://example.com/edge-840'
          })
        )
        mockDb.getFitnessGearDeviceRollups.mockResolvedValue({
          'gear-1': { activityCount: 41, firstUsedAt: 1_600_000_000_000 }
        })

        const response = await PATCH(
          patchRequest({
            name: 'the Edge',
            productUrl: 'https://example.com/edge-840'
          }),
          params
        )
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(mockDb.updateFitnessGear).toHaveBeenCalledWith(
          expect.objectContaining({
            productUrl: 'https://example.com/edge-840'
          })
        )
        // A device rolls up a count and a first-used date, never a distance.
        expect(mockDb.getFitnessGearDistanceRollups).not.toHaveBeenCalled()
        expect(data.gear).toMatchObject({
          kind: 'device',
          distanceMeters: 0,
          activityCount: 41,
          firstUsedAt: 1_600_000_000_000,
          productUrl: 'https://example.com/edge-840'
        })
      })

      it.each([
        { description: 'a frame type', body: { bikeType: 'Road bike' } },
        { description: 'a weight', body: { weightKilograms: 0.1 } },
        {
          description: 'a distance alert',
          body: { alertDistanceMeters: 650_000 }
        },
        { description: 'a default sport', body: { defaultSports: ['ride'] } }
      ])('rejects $description with 422', async ({ body }) => {
        mockDb.getFitnessGear.mockResolvedValue(device())

        const response = await PATCH(patchRequest(body), params)

        expect(response.status).toBe(422)
        expect(mockDb.updateFitnessGear).not.toHaveBeenCalled()
      })

      it('rejects a product page on a bike with 422', async () => {
        mockDb.getFitnessGear.mockResolvedValue(gear())

        const response = await PATCH(
          patchRequest({ productUrl: 'https://www.garmin.com' }),
          params
        )
        const data = await response.json()

        expect(response.status).toBe(422)
        expect(data.error).toBe('productUrl is only valid for a device')
        expect(mockDb.updateFitnessGear).not.toHaveBeenCalled()
      })

      it('rejects a product page that is not an http(s) URL', async () => {
        mockDb.getFitnessGear.mockResolvedValue(device())

        const response = await PATCH(
          patchRequest({ productUrl: 'javascript:alert(1)' }),
          params
        )

        expect(response.status).toBe(422)
        expect(mockDb.updateFitnessGear).not.toHaveBeenCalled()
      })
    })
  })

  describe('DELETE', () => {
    it('deletes the gear', async () => {
      mockDb.deleteFitnessGear.mockResolvedValue(true)

      const response = await DELETE(
        new NextRequest('http://llun.test/api/v1/fitness/gear/gear-1', {
          method: 'DELETE',
          headers: { Origin: 'https://llun.test' }
        }),
        params
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({ success: true })
      expect(mockDb.deleteFitnessGear).toHaveBeenCalledWith({
        id: 'gear-1',
        actorId: ACTOR1_ID
      })
    })

    it('answers 404 when nothing was deleted', async () => {
      mockDb.deleteFitnessGear.mockResolvedValue(false)

      const response = await DELETE(
        new NextRequest('http://llun.test/api/v1/fitness/gear/gear-1', {
          method: 'DELETE',
          headers: { Origin: 'https://llun.test' }
        }),
        params
      )
      expect(response.status).toBe(404)
    })
  })
})
