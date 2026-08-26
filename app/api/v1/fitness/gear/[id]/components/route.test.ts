import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import {
  FitnessGear,
  FitnessGearComponent
} from '@/lib/types/database/fitnessGear'

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
  | 'getFitnessGear'
  | 'getFitnessGearComponents'
  | 'createFitnessGearComponent'
  | 'getFitnessGearComponentDistanceRollups'
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

const gear: FitnessGear = {
  id: 'gear-1',
  actorId: ACTOR1_ID,
  kind: 'bike',
  name: 'Moots',
  defaultSports: [],
  createdAt: 1000,
  updatedAt: 1000
}

// `addedAt` and `removedAt` are derived from the install periods, so a fixture
// setting either gets a matching single period unless the test states its own.
const component = (
  overrides: Partial<FitnessGearComponent> = {}
): FitnessGearComponent => {
  const built = {
    id: 'component-1',
    gearId: 'gear-1',
    componentType: 'Chain',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides
  }
  return {
    ...built,
    periods: overrides.periods ?? [
      {
        id: 'period-1',
        componentId: built.id,
        installSequence: 1,
        addedAt: built.addedAt,
        removedAt: built.removedAt,
        createdAt: built.createdAt,
        updatedAt: built.updatedAt
      }
    ]
  }
}

describe('Fitness gear components API', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessGear: vi.fn(),
    getFitnessGearComponents: vi.fn(),
    createFitnessGearComponent: vi.fn(),
    getFitnessGearComponentDistanceRollups: vi.fn(),
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
    mockDb.getFitnessGear.mockResolvedValue(gear)
    mockDb.getFitnessGearComponents.mockResolvedValue([])
    mockDb.getFitnessGearComponentDistanceRollups.mockResolvedValue({})
  })

  const params = { params: Promise.resolve({ id: 'gear-1' }) }

  const postRequest = (body: unknown) =>
    new NextRequest('http://llun.test/api/v1/fitness/gear/gear-1/components', {
      method: 'POST',
      headers: { Origin: 'https://llun.test' },
      body: JSON.stringify(body)
    })

  describe('GET', () => {
    it('returns components with their window-restricted distance', async () => {
      mockDb.getFitnessGearComponents.mockResolvedValue([component()])
      mockDb.getFitnessGearComponentDistanceRollups.mockResolvedValue({
        'component-1': { distanceMeters: 6_550, activityCount: 3 }
      })

      const response = await GET(
        new NextRequest(
          'http://llun.test/api/v1/fitness/gear/gear-1/components',
          { method: 'GET' }
        ),
        params
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.components[0]).toMatchObject({
        componentType: 'Chain',
        distanceMeters: 6_550,
        activityCount: 3
      })
    })

    it('answers 404 for gear the actor does not own', async () => {
      mockDb.getFitnessGear.mockResolvedValue(null)

      const response = await GET(
        new NextRequest(
          'http://llun.test/api/v1/fitness/gear/gear-1/components',
          { method: 'GET' }
        ),
        params
      )

      expect(response.status).toBe(404)
      expect(mockDb.getFitnessGearComponents).not.toHaveBeenCalled()
    })

    it('rejects a recording device with 422', async () => {
      // A device has no parts to service — a chain does not wear out on a
      // watch.
      mockDb.getFitnessGear.mockResolvedValue({
        ...gear,
        kind: 'device',
        name: 'Garmin Edge 840'
      })

      const response = await GET(
        new NextRequest(
          'http://llun.test/api/v1/fitness/gear/gear-1/components',
          { method: 'GET' }
        ),
        params
      )
      const data = await response.json()

      expect(response.status).toBe(422)
      expect(data.error).toBe('A recording device has no components')
      expect(mockDb.getFitnessGearComponents).not.toHaveBeenCalled()
    })
  })

  describe('POST', () => {
    it('creates a component, converting epoch dates', async () => {
      mockDb.createFitnessGearComponent.mockResolvedValue(
        component({ addedAt: 1_700_000_000_000 })
      )

      const response = await POST(
        postRequest({
          componentType: 'Chain',
          addedAt: 1_700_000_000_000,
          serviceDistanceMeters: 5_000_000
        }),
        params
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.component).toMatchObject({ componentType: 'Chain' })
      expect(mockDb.createFitnessGearComponent).toHaveBeenCalledWith(
        expect.objectContaining({
          gearId: 'gear-1',
          actorId: ACTOR1_ID,
          componentType: 'Chain',
          addedAt: new Date(1_700_000_000_000),
          serviceDistanceMeters: 5_000_000
        })
      )
    })

    it('treats a missing added date as "since beginning"', async () => {
      mockDb.createFitnessGearComponent.mockResolvedValue(component())

      await POST(postRequest({ componentType: 'Frame' }), params)

      expect(mockDb.createFitnessGearComponent).toHaveBeenCalledWith(
        expect.objectContaining({ addedAt: null, removedAt: null })
      )
    })

    it('answers 404 when the gear is not the actor’s', async () => {
      mockDb.getFitnessGear.mockResolvedValue(null)
      mockDb.createFitnessGearComponent.mockResolvedValue(null)

      const response = await POST(
        postRequest({ componentType: 'Chain' }),
        params
      )
      expect(response.status).toBe(404)
    })

    it('rejects fitting a component to a recording device with 422', async () => {
      mockDb.getFitnessGear.mockResolvedValue({
        ...gear,
        kind: 'device',
        name: 'Garmin Edge 840'
      })

      const response = await POST(
        postRequest({ componentType: 'Chain' }),
        params
      )
      const data = await response.json()

      expect(response.status).toBe(422)
      expect(data.error).toBe('A recording device has no components')
      expect(mockDb.createFitnessGearComponent).not.toHaveBeenCalled()
    })

    it.each([
      {
        description: 'the component type is empty',
        body: { componentType: '' }
      },
      {
        description: 'the removal date precedes the added date',
        body: {
          componentType: 'Chain',
          addedAt: 1_700_000_000_000,
          removedAt: 1_600_000_000_000
        }
      },
      {
        description: 'the service distance is negative',
        body: { componentType: 'Chain', serviceDistanceMeters: -5 }
      }
    ])('rejects with 422 when $description', async ({ body }) => {
      const response = await POST(postRequest(body), params)
      expect(response.status).toBe(422)
      expect(mockDb.createFitnessGearComponent).not.toHaveBeenCalled()
    })
  })
})
